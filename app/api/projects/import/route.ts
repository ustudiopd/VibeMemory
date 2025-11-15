import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createWebhook, getRepositoryInfo } from '@/lib/github';
import { runInitialScan } from '@/lib/runInitialScan';
import { getSystemUser, getSystemUserFromSupabase } from '@/lib/system-user';

export async function POST(request: NextRequest) {
  try {
    const systemUser = getSystemUser();
    if (!systemUser || !systemUser.githubAccessToken) {
      return NextResponse.json(
        { error: '시스템 GitHub Access Token이 설정되지 않았습니다.' },
        { status: 401 }
      );
    }

    const { repo_name, repo_owner } = await request.json();

    if (!repo_name || !repo_owner) {
      return NextResponse.json(
        { error: 'repo_name and repo_owner are required' },
        { status: 400 }
      );
    }

    // 시스템 사용자 가져오기
    const user = await getSystemUserFromSupabase();

    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다. 환경 변수를 확인해주세요.' },
        { status: 404 }
      );
    }

    const ownerId = user.id;
    const repoUrl = `https://github.com/${repo_owner}/${repo_name}`;
    const jobName = `import:${repo_owner}/${repo_name}`;

    // Check if project already exists first
    const { data: existingProjects, error: checkError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('repo_url', repoUrl)
      .eq('owner_id', ownerId)
      .limit(1);
    
    const existingProject = existingProjects && existingProjects.length > 0 ? existingProjects[0] : null;

    if (existingProject) {
      return NextResponse.json(
        { 
          error: '이미 임포트된 프로젝트입니다.', 
          project_id: existingProject.id 
        },
        { status: 409 }
      );
    }

    // CLAIM: Check if job is already running
    // 먼저 만료된 잠금 정리
    const { error: cleanupError } = await supabaseAdmin
      .from('job_locks')
      .delete()
      .eq('job_name', jobName)
      .lt('expires_at', new Date().toISOString());
    
    if (cleanupError) {
      console.warn('[IMPORT] Error cleaning up expired locks:', cleanupError);
    }

    // 프로젝트가 존재하지 않으면 잠금을 강제로 삭제 (삭제된 프로젝트의 잠금 정리)
    if (!existingProject) {
      console.log('[IMPORT] No existing project found, cleaning up any stale locks');
      const { error: deleteLockError } = await supabaseAdmin
        .from('job_locks')
        .delete()
        .eq('job_name', jobName);
      
      if (deleteLockError) {
        console.error('[IMPORT] Error deleting stale lock:', deleteLockError);
      } else {
        console.log('[IMPORT] Deleted stale lock for:', jobName);
      }
      
      // 잠금 삭제 후 잠시 대기 (동시성 문제 방지)
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // 잠금 획득 시도 (최대 3번 재시도)
    let claimResult: boolean | null = false;
    let claimError: any = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await supabaseAdmin.rpc('claim_job', {
        p_job_name: jobName,
        p_duration: '1 hour',
      });
      
      claimResult = result.data;
      claimError = result.error;
      
      if (claimResult) {
        console.log(`[IMPORT] Successfully claimed job on attempt ${attempt + 1}`);
        break; // 성공
      }
      
      if (claimError) {
        console.error(`[IMPORT] claim_job error (attempt ${attempt + 1}):`, claimError);
        // RPC 함수가 존재하지 않는 경우 등 심각한 에러
        if (claimError.message?.includes('function') || claimError.message?.includes('does not exist')) {
          console.error('[IMPORT] claim_job RPC function may not exist:', claimError);
          return NextResponse.json(
            { 
              error: '시스템 오류가 발생했습니다. 잠금 관리 기능을 사용할 수 없습니다.', 
              details: claimError.message 
            },
            { status: 500 }
          );
        }
      }
      
      if (attempt < 2) {
        // 재시도 전에 잠금 다시 확인 및 정리
        console.log(`[IMPORT] claim_job failed (attempt ${attempt + 1}), cleaning up and retrying...`);
        await supabaseAdmin
          .from('job_locks')
          .delete()
          .eq('job_name', jobName);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    if (claimError || !claimResult) {
      console.error('[IMPORT] Failed to claim job after all retries:', {
        claimError,
        claimResult,
        jobName,
        attempts: 3,
      });
      
      // 프로젝트가 존재하지 않으면 잠금 없이 진행 (동시성 위험이 있지만 임포트는 강제로 진행)
      if (!existingProject) {
        console.warn('[IMPORT] Project does not exist, proceeding without lock - concurrency risk accepted');
        // 잠금 없이 계속 진행
      } else {
        return NextResponse.json(
          { 
            error: '이 리포지토리는 현재 임포트 중입니다. 잠시 후 다시 시도해주세요.',
            details: claimError?.message || 'Failed to claim job after retries'
          },
          { status: 409 }
        );
      }
    }

    // Get GitHub repository info to auto-fill project details
    let repoInfo: any = null;
    try {
      repoInfo = await getRepositoryInfo(
        systemUser.githubAccessToken,
        repo_owner,
        repo_name
      );
      console.log('[IMPORT] Fetched GitHub repository info:', {
        name: repoInfo.name,
        description: repoInfo.description,
        homepage: repoInfo.homepage,
      });
    } catch (error) {
      console.error('[IMPORT] Error fetching repository info:', error);
      // Continue without repo info if fetch fails
    }

    // Create webhook
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/github/webhook`;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET!;

    let webhookId: number | null = null;
    try {
      const webhook = await createWebhook(
        systemUser.githubAccessToken,
        repo_owner,
        repo_name,
        webhookUrl,
        webhookSecret
      );
      webhookId = webhook.id;
    } catch (error) {
      console.error('Error creating webhook:', error);
      // Continue without webhook if creation fails
    }

    // Insert project into database with GitHub info
    const { data: project, error: insertError } = await supabaseAdmin
      .from('projects')
      .insert({
        owner_id: ownerId,
        repo_owner,
        repo_name,
        repo_url: repoUrl,
        webhook_id: webhookId,
        // Auto-fill from GitHub repository info
        project_name: repoInfo?.name || repo_name,
        description: repoInfo?.description || null,
        deployment_url: repoInfo?.homepage || null,
        repository_url: repoInfo?.html_url || repoUrl,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: 'Failed to create project', details: insertError.message },
        { status: 500 }
      );
    }

    // Create ingestion_run with PENDING status (Cron Worker will process it)
    const { data: newRun, error: runError } = await supabaseAdmin
      .from('ingestion_runs')
      .insert({
        project_id: project.id,
        phase: 'indexing',
        status: 'pending',  // Cron Worker가 처리할 작업으로 등록
      })
      .select()
      .single();

    if (runError) {
      console.error('[IMPORT] Error creating pending ingestion run:', runError);
      // 에러가 발생해도 프로젝트 생성은 성공으로 처리
      // (Cron Worker가 다음 실행 시 처리할 수 있음)
    } else {
      console.log(`[IMPORT] Created pending ingestion_run: ${newRun.id} for project ${project.id}`);
      
      // scan_progress 초기화
      await supabaseAdmin.from('scan_progress').insert({
        run_id: newRun.id,
        project_id: project.id,
        md_total: 0,
        md_indexed: 0,
        chunk_total: 0,
        review_done: 0,
        review_total: 4,
      });
    }

    return NextResponse.json(
      {
        success: true,
        project_id: project.id,
        message: 'Project imported successfully. Initial scan will start shortly.',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error importing project:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

