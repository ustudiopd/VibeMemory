import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createWebhook } from '@/lib/github';
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
      return NextResponse.json(
        { error: '이 리포지토리는 현재 임포트 중입니다. 잠시 후 다시 시도해주세요.', details: claimError.message },
        { status: 409 }
      );
    }

    if (!claimResult) {
      console.log('[DEBUG] claim_job returned false - job already claimed');
      return NextResponse.json(
        { error: '이 리포지토리는 현재 임포트 중입니다. 잠시 후 다시 시도해주세요.' },
        { status: 409 }
      );
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

    // Insert project into database
    const { data: project, error: insertError } = await supabaseAdmin
      .from('projects')
      .insert({
        owner_id: ownerId,
        repo_owner,
        repo_name,
        repo_url: repoUrl,
        webhook_id: webhookId,
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

