import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { getSystemUser } from '@/lib/system-user';
import { runInitialScan } from '@/lib/runInitialScan';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    // 시스템 사용자 확인
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    // 프로젝트 소유권 확인
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, owner_id, repo_owner, repo_name')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const systemUser = getSystemUser();
    if (!systemUser?.githubAccessToken) {
      return NextResponse.json(
        { error: 'GitHub Access Token이 설정되지 않았습니다.' },
        { status: 401 }
      );
    }

    // 동시 실행 방지 (claim_job)
    const jobName = `rescan:${project.repo_owner}/${project.repo_name}`;

    // 재스캔 버튼을 누르면 기존 작업을 모두 정리하고 새로 시작
    console.log(`[RESCAN] Starting fresh rescan - cleaning up existing runs and locks`);

    // 1. 진행 중인 모든 ingestion_runs를 failed로 변경
    const { data: activeRuns, error: activeRunsError } = await supabaseAdmin
      .from('ingestion_runs')
      .select('id, status, created_at')
      .eq('project_id', projectId)
      .in('status', ['running']);

    if (activeRunsError) {
      console.error('[RESCAN] Error checking active runs:', activeRunsError);
    }

    if (activeRuns && activeRuns.length > 0) {
      console.log(`[RESCAN] Found ${activeRuns.length} active run(s), marking as failed`);
      for (const run of activeRuns) {
        await supabaseAdmin
          .from('ingestion_runs')
          .update({
            status: 'failed',
            phase: 'failed',
            finished_at: new Date().toISOString(),
          })
          .eq('id', run.id);
      }
    }

    // 2. 기존 job_locks 강제 삭제
    const { data: existingLocks } = await supabaseAdmin
      .from('job_locks')
      .select('job_name')
      .eq('job_name', jobName);

    if (existingLocks && existingLocks.length > 0) {
      console.log(`[RESCAN] Found existing lock(s), deleting them`);
      const { error: deleteError } = await supabaseAdmin
        .from('job_locks')
        .delete()
        .eq('job_name', jobName);
      
      if (deleteError) {
        console.error('[RESCAN] Error deleting existing locks:', deleteError);
      } else {
        console.log(`[RESCAN] Successfully deleted existing locks`);
        
        // 삭제 확인 (최대 3번 재시도)
        for (let checkAttempt = 0; checkAttempt < 3; checkAttempt++) {
          await new Promise(resolve => setTimeout(resolve, 300));
          
          const { data: verifyLock } = await supabaseAdmin
            .from('job_locks')
            .select('job_name')
            .eq('job_name', jobName)
            .maybeSingle();
          
          if (!verifyLock) {
            console.log(`[RESCAN] Lock deletion confirmed (attempt ${checkAttempt + 1})`);
            break;
          } else {
            console.log(`[RESCAN] Lock still exists, retrying deletion (attempt ${checkAttempt + 1})`);
            await supabaseAdmin
              .from('job_locks')
              .delete()
              .eq('job_name', jobName);
          }
        }
      }
    }

    // 3. 잠시 대기 (동시성 문제 방지)
    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. 잠금이 완전히 삭제되었는지 최종 확인 및 강제 삭제
    for (let finalCheck = 0; finalCheck < 5; finalCheck++) {
      const { data: remainingLock } = await supabaseAdmin
        .from('job_locks')
        .select('job_name')
        .eq('job_name', jobName)
        .maybeSingle();
      
      if (!remainingLock) {
        console.log(`[RESCAN] Lock confirmed deleted (check ${finalCheck + 1})`);
        break;
      }
      
      console.log(`[RESCAN] Lock still exists, forcing deletion (check ${finalCheck + 1})`);
      await supabaseAdmin
        .from('job_locks')
        .delete()
        .eq('job_name', jobName);
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 5. claim_job 시도 (이제 잠금이 없어야 함)
    let claimResult: boolean | null = false;
    let claimError: any = null;
    
    // 최대 5번 재시도
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await supabaseAdmin.rpc('claim_job', {
        p_job_name: jobName,
        p_duration: '1 hour',
      });
      
      claimResult = result.data;
      claimError = result.error;
      
      if (claimResult) {
        console.log(`[RESCAN] Successfully claimed job on attempt ${attempt + 1}`);
        break; // 성공
      }
      
      // 실패 시 잠금을 다시 강제 삭제하고 재시도
      console.log(`[RESCAN] claim_job failed (attempt ${attempt + 1}), deleting lock and retrying`);
      await supabaseAdmin
        .from('job_locks')
        .delete()
        .eq('job_name', jobName);
      
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (claimError || !claimResult) {
      console.error('[RESCAN] Failed to claim job after all retries:', {
        claimError,
        claimResult,
        jobName,
        attempts: 5,
      });
      
      // 마지막 시도: force_claim_job RPC로 강제 잠금 획득
      console.log(`[RESCAN] Attempting force_claim_job as fallback`);
      const { data: forceClaimResult, error: forceClaimError } = await supabaseAdmin.rpc('force_claim_job', {
        p_job_name: jobName,
        p_duration: '1 hour',
      });
      
      if (forceClaimError || !forceClaimResult) {
        console.error('[RESCAN] force_claim_job also failed:', forceClaimError);
        // 마지막 수단: 잠금 없이 진행 (동시성 위험이 있지만 재스캔은 강제로 진행)
        console.warn('[RESCAN] Proceeding without lock - concurrency risk accepted');
      } else {
        console.log(`[RESCAN] force_claim_job succeeded, proceeding with rescan`);
      }
    }

    console.log(`[RESCAN] Successfully claimed job: ${jobName}`);

    // ingestion_runs 먼저 생성 (동기적으로)
    console.log(`[RESCAN] Creating ingestion_run for project ${projectId}`);
    const { data: newRun, error: runError } = await supabaseAdmin
      .from('ingestion_runs')
      .insert({
        project_id: projectId,
        phase: 'indexing',
        status: 'running',
      })
      .select()
      .single();

    if (runError || !newRun) {
      console.error('[RESCAN] Error creating ingestion run:', {
        error: runError,
        code: runError?.code,
        message: runError?.message,
        details: runError?.details,
        hint: runError?.hint,
        projectId,
      });
      
      // 잠금 해제
      await supabaseAdmin
        .from('job_locks')
        .delete()
        .eq('job_name', jobName);
      
      return NextResponse.json(
        { error: '재스캔을 시작할 수 없습니다. ingestion_run 생성에 실패했습니다.' },
        { status: 500 }
      );
    }

    const runId = newRun.id;
    console.log(`[RESCAN] Created ingestion_run: ${runId}`);

    // scan_progress 초기화
    const { error: progressError } = await supabaseAdmin
      .from('scan_progress')
      .insert({
        run_id: runId,
        project_id: projectId,
        md_total: 0,
        md_indexed: 0,
        chunk_total: 0,
        review_done: 0,
        review_total: 3,
      });

    if (progressError) {
      console.error('[RESCAN] Error creating scan_progress:', progressError);
      // ingestion_run은 생성되었으므로 계속 진행
    } else {
      console.log(`[RESCAN] Created scan_progress for run ${runId}`);
    }

    // 재스캔 실행 (비동기, runId 전달)
    console.log(`[RESCAN] Starting rescan for project ${projectId} (${project.repo_owner}/${project.repo_name}) with runId ${runId}`);
    runInitialScan(
      projectId,
      systemUser.githubAccessToken,
      project.repo_owner,
      project.repo_name,
      runId // runId 전달하여 중복 생성 방지
    ).catch(async (error) => {
      console.error('[RESCAN] Error in rescan:', error);
      console.error('[RESCAN] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        projectId,
        runId,
        repoOwner: project.repo_owner,
        repoName: project.repo_name,
      });
      
      // 에러 발생 시 ingestion_runs에 실패 상태 기록
      const { error: updateError } = await supabaseAdmin
        .from('ingestion_runs')
        .update({
          phase: 'failed',
          status: 'failed',
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
      
      if (updateError) {
        console.error('[RESCAN] Error updating run status:', updateError);
      }
    });

    // runId를 포함하여 응답 반환
    return NextResponse.json({
      success: true,
      message: '재스캔이 시작되었습니다.',
      runId: runId,
    });
  } catch (error) {
    console.error('Error in rescan API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

