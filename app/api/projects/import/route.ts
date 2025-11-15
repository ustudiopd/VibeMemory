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
    // 프로젝트가 존재하지 않으면 잠금을 강제로 삭제 (삭제된 프로젝트의 잠금 정리)
    if (!existingProject) {
      console.log('[DEBUG] No existing project found, cleaning up any stale locks');
      await supabaseAdmin
        .from('job_locks')
        .delete()
        .eq('job_name', jobName);
    }

    const { data: claimResult, error: claimError } = await supabaseAdmin.rpc(
      'claim_job',
      {
        p_job_name: jobName,
        p_duration: '1 hour',
      }
    );

    console.log('[DEBUG] claim_job result:', { claimResult, claimError, jobName });

    if (claimError) {
      console.error('[DEBUG] claim_job error:', claimError);
      // 프로젝트가 존재하지 않으면 잠금을 강제로 삭제하고 재시도
      if (!existingProject) {
        console.log('[DEBUG] Project does not exist, force deleting lock and retrying');
        await supabaseAdmin
          .from('job_locks')
          .delete()
          .eq('job_name', jobName);
        
        // 재시도
        const { data: retryResult, error: retryError } = await supabaseAdmin.rpc(
          'claim_job',
          {
            p_job_name: jobName,
            p_duration: '1 hour',
          }
        );
        
        if (retryError || !retryResult) {
          return NextResponse.json(
            { error: '이 리포지토리는 현재 임포트 중입니다. 잠시 후 다시 시도해주세요.', details: retryError?.message || 'Failed to claim job' },
            { status: 409 }
          );
        }
        // 재시도 성공, 계속 진행
      } else {
        return NextResponse.json(
          { error: '이 리포지토리는 현재 임포트 중입니다. 잠시 후 다시 시도해주세요.', details: claimError.message },
          { status: 409 }
        );
      }
    } else if (!claimResult) {
      console.log('[DEBUG] claim_job returned false - job already claimed');
      // 프로젝트가 존재하지 않으면 잠금을 강제로 삭제하고 재시도
      if (!existingProject) {
        console.log('[DEBUG] Project does not exist, force deleting lock and retrying');
        await supabaseAdmin
          .from('job_locks')
          .delete()
          .eq('job_name', jobName);
        
        // 재시도
        const { data: retryResult, error: retryError } = await supabaseAdmin.rpc(
          'claim_job',
          {
            p_job_name: jobName,
            p_duration: '1 hour',
          }
        );
        
        if (retryError || !retryResult) {
          return NextResponse.json(
            { error: '이 리포지토리는 현재 임포트 중입니다. 잠시 후 다시 시도해주세요.' },
            { status: 409 }
          );
        }
        // 재시도 성공, 계속 진행
      } else {
        return NextResponse.json(
          { error: '이 리포지토리는 현재 임포트 중입니다. 잠시 후 다시 시도해주세요.' },
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

    // Trigger initial scan asynchronously (don't wait for it)
    runInitialScan(project.id, systemUser.githubAccessToken, repo_owner, repo_name).catch(
      (error) => {
        console.error('Error in initial scan:', error);
      }
    );

    return NextResponse.json(
      {
        success: true,
        project_id: project.id,
        message: 'Project imported successfully. Initial scan started.',
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

