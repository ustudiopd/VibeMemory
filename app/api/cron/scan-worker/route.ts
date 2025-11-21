import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runInitialScan } from '@/lib/runInitialScan';
import { getSystemUser, getSystemUserFromSupabase } from '@/lib/system-user';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Vercel Cron 인증 검증 (보안)
    // Vercel Cron은 자동으로 x-vercel-cron 헤더를 보냅니다
    const cronHeader = request.headers.get('x-vercel-cron');
    const authHeader = request.headers.get('authorization');
    
    // Vercel Cron 헤더가 있거나, Authorization 헤더가 올바른 경우 허용
    const isVercelCron = cronHeader === '1';
    const isValidAuth = authHeader === `Bearer ${process.env.CRON_SECRET}`;
    
    if (!isVercelCron && !isValidAuth) {
      // CRON_SECRET이 설정되지 않은 경우 개발 환경에서는 경고만
      if (!process.env.CRON_SECRET) {
        console.warn('[SCAN-WORKER] CRON_SECRET not set, allowing request (development mode)');
      } else {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // PENDING 상태의 ingestion_run 찾기
    const { data: pendingRun, error: findError } = await supabaseAdmin
      .from('ingestion_runs')
      .select(`
        id,
        project_id,
        projects!inner(
          repo_owner,
          repo_name,
          owner_id
        )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error('[SCAN-WORKER] Error finding pending runs:', findError);
      return NextResponse.json(
        { error: 'Failed to find pending jobs', details: findError.message },
        { status: 500 }
      );
    }

    if (!pendingRun) {
      return NextResponse.json({ message: 'No pending jobs.' });
    }

    // 타입 안전성을 위한 프로젝트 데이터 추출
    const projectData = pendingRun.projects as any;
    if (!projectData || Array.isArray(projectData)) {
      return NextResponse.json({ error: 'Invalid project data' }, { status: 500 });
    }

    const project = {
      repo_owner: projectData.repo_owner as string,
      repo_name: projectData.repo_name as string,
      owner_id: projectData.owner_id as string,
    };

    // Job lock 획득 (동시 실행 방지)
    const jobName = `scan:${pendingRun.project_id}`;
    const { data: claimResult, error: claimError } = await supabaseAdmin
      .schema('public')
      .rpc('claim_job', {
        p_job_name: jobName,
        p_duration: '1 hour',
      });

    if (claimError || !claimResult) {
      console.log(`[SCAN-WORKER] Job ${jobName} already claimed, skipping`);
      return NextResponse.json({ message: 'Job already claimed by another worker' });
    }

    // PROCESSING 상태로 변경
    const { error: updateError } = await supabaseAdmin
      .from('ingestion_runs')
      .update({ status: 'running' })
      .eq('id', pendingRun.id);

    if (updateError) {
      console.error('[SCAN-WORKER] Error updating run status:', updateError);
      // 상태 업데이트 실패해도 계속 진행
    }

    try {
      // 시스템 사용자 정보 가져오기
      const systemUser = getSystemUser();
      if (!systemUser?.githubAccessToken) {
        throw new Error('GitHub Access Token not available');
      }

      console.log(`[SCAN-WORKER] Starting scan for project ${pendingRun.project_id} (run: ${pendingRun.id})`);

      // 실제 스캔 실행
      await runInitialScan(
        pendingRun.project_id,
        systemUser.githubAccessToken,
        project.repo_owner,
        project.repo_name,
        pendingRun.id  // runId 전달
      );

      // 완료 상태는 runInitialScan 내부에서 업데이트됨
      console.log(`[SCAN-WORKER] Successfully processed project ${project.repo_name}`);
      
      return NextResponse.json({
        message: `Project ${project.repo_name} processed successfully.`,
        project_id: pendingRun.project_id,
        run_id: pendingRun.id,
      });
    } catch (error) {
      // 실패 상태 업데이트
      await supabaseAdmin
        .from('ingestion_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
        })
        .eq('id', pendingRun.id);

      console.error('[SCAN-WORKER] Error processing project:', error);
      return NextResponse.json(
        {
          error: `Failed to process project: ${error instanceof Error ? error.message : 'Unknown error'}`,
          project_id: pendingRun.project_id,
          run_id: pendingRun.id,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[SCAN-WORKER] Unexpected error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

