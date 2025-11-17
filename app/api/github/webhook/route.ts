import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

// Node.js 런타임 사용 (crypto 모듈, Service Role Key 사용 안전)
export const runtime = 'nodejs';
export const maxDuration = 60;

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

function verifySignature(payload: string, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

export async function POST(request: NextRequest) {
  let deliveryId: string | null = null;
  let projectId: string | null = null;
  
  try {
    // 헤더 추출
    const signature = request.headers.get('x-hub-signature-256');
    deliveryId = request.headers.get('x-github-delivery') || null;
    const eventType = request.headers.get('x-github-event') || '';
    
    // 원문 읽기 (HMAC 검증 전)
    const payload = await request.text();

    if (!signature) {
      console.error('[WEBHOOK] Missing signature', { deliveryId });
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 401 }
      );
    }

    // Verify HMAC signature (원문으로 검증)
    if (!verifySignature(payload, signature)) {
      console.error('[WEBHOOK] Invalid signature', { deliveryId });
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // HMAC 검증 통과 후 JSON 파싱
    const event = JSON.parse(payload);
    console.log(`[WEBHOOK] Event type: ${eventType}`, { deliveryId });

    // Idempotency 확인 (중복 처리 방지)
    if (deliveryId) {
      const { data: existing } = await supabaseAdmin
        .from('webhook_deliveries')
        .select('delivery_id, status')
        .eq('delivery_id', deliveryId)
        .maybeSingle();

      if (existing) {
        console.log(`[WEBHOOK] Duplicate delivery detected: ${deliveryId}`, { 
          deliveryId, 
          status: existing.status 
        });
        return NextResponse.json(
          { message: 'duplicate delivery' },
          { status: 200 }
        );
      }

      // Delivery 기록 (처리 시작 전)
      await supabaseAdmin
        .from('webhook_deliveries')
        .insert({
          delivery_id: deliveryId,
          event: eventType,
          status: 'processing',
        });
    }

    if (eventType !== 'push') {
      console.log(`[WEBHOOK] Event ignored (type: ${eventType})`, { deliveryId });
      // Delivery 기록 업데이트 (처리 완료)
      if (deliveryId) {
        await supabaseAdmin
          .from('webhook_deliveries')
          .update({ status: 'done', processed_at: new Date().toISOString() })
          .eq('delivery_id', deliveryId);
      }
      return NextResponse.json({ message: 'Event ignored' }, { status: 200 });
    }

    // 브랜치 필터링 (기본 브랜치만 처리)
    const defaultBranch = event.repository?.default_branch || 'main';
    const ref = event.ref || '';
    
    if (ref && ref !== `refs/heads/${defaultBranch}`) {
      console.log(`[WEBHOOK] Skipping non-default branch: ${ref}`, { 
        deliveryId, 
        defaultBranch, 
        ref 
      });
      // Delivery 기록 업데이트 (처리 완료)
      if (deliveryId) {
        await supabaseAdmin
          .from('webhook_deliveries')
          .update({ 
            status: 'done', 
            processed_at: new Date().toISOString(),
            project_id: projectId || null,
          })
          .eq('delivery_id', deliveryId);
      }
      return NextResponse.json(
        { message: 'skip non-default branch' },
        { status: 200 }
      );
    }

    const { repository, commits } = event;
    const repoOwner = repository.owner.login;
    const repoName = repository.name;
    const repoUrl = repository.html_url;
    
    console.log(`[WEBHOOK] Processing push event for ${repoOwner}/${repoName}`, { deliveryId });
    console.log(`[WEBHOOK] Commits: ${commits.length}`, { deliveryId });

    // Find project (시스템 사용자의 프로젝트만)
    const { getSystemUserFromSupabase } = await import('@/lib/system-user');
    const systemUser = await getSystemUserFromSupabase();
    
    if (!systemUser) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, owner_id')
      .eq('repo_url', repoUrl)
      .eq('owner_id', systemUser.id)
      .single();

    if (projectError || !project) {
      console.error(`[WEBHOOK] Project not found for ${repoUrl}`, { 
        deliveryId, 
        repoUrl, 
        error: projectError 
      });
      // Delivery 기록 업데이트 (에러)
      if (deliveryId) {
        await supabaseAdmin
          .from('webhook_deliveries')
          .update({ 
            status: 'error', 
            processed_at: new Date().toISOString(),
            error_json: { error: 'Project not found', repoUrl },
          })
          .eq('delivery_id', deliveryId);
      }
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    projectId = project.id;
    
    // 로그 컨텍스트 객체 생성
    const logContext = {
      deliveryId,
      projectId,
      repoOwner,
      repoName,
    };
    
    console.log(`[WEBHOOK] Found project, queuing job`, logContext);

    // 빠른 ACK: webhook_jobs에 작업 등록 후 즉시 응답
    if (!deliveryId) {
      // deliveryId가 없으면 UUID 생성 (드문 경우)
      deliveryId = crypto.randomUUID();
    }

    // webhook_jobs에 작업 등록 (UPSERT로 중복 방지)
    const { error: jobError } = await supabaseAdmin
      .from('webhook_jobs')
      .upsert({
        delivery_id: deliveryId,
        project_id: projectId,
        payload: event,
        status: 'pending',
        retry_count: 0,
      }, {
        onConflict: 'delivery_id',
        ignoreDuplicates: false,
      });

    if (jobError) {
      console.error('[WEBHOOK] Failed to queue job:', { ...logContext, error: jobError });
      // Delivery 기록 업데이트 (에러)
      if (deliveryId) {
        await supabaseAdmin
          .from('webhook_deliveries')
          .update({ 
            status: 'error', 
            processed_at: new Date().toISOString(),
            project_id: projectId,
            error_json: { error: 'Failed to queue job', jobError },
          })
          .eq('delivery_id', deliveryId);
      }
      return NextResponse.json(
        { error: 'Failed to queue job' },
        { status: 500 }
      );
    }

    // Delivery 기록 업데이트 (큐에 등록됨)
    if (deliveryId) {
      await supabaseAdmin
        .from('webhook_deliveries')
        .update({ 
          status: 'processing',
          project_id: projectId,
        })
        .eq('delivery_id', deliveryId);
    }

    console.log(`[WEBHOOK] Job queued successfully`, logContext);
    
    // 즉시 200 OK 반환 (실제 처리는 워커가 수행)
    return NextResponse.json(
      { message: 'Webhook received and queued for processing' },
      { status: 200 }
    );
  } catch (error) {
    const errorContext = {
      deliveryId,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    };
    console.error('[WEBHOOK] Error processing webhook:', errorContext);
    
    // Delivery 기록 업데이트 (에러)
    if (deliveryId) {
      try {
        await supabaseAdmin
          .from('webhook_deliveries')
          .update({ 
            status: 'error', 
            processed_at: new Date().toISOString(),
            project_id: projectId || null,
            error_json: { 
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          })
          .eq('delivery_id', deliveryId);
      } catch (updateError) {
        console.error('[WEBHOOK] Failed to update delivery status:', { deliveryId, updateError });
      }
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

