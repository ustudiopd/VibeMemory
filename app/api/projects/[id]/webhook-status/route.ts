import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase, getSystemUser } from '@/lib/system-user';
import { Octokit } from '@octokit/rest';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 시스템 사용자 확인
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId } = await params;

    // 프로젝트 정보 조회
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, repo_owner, repo_name, webhook_id')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // GitHub Access Token 확인
    const systemUser = getSystemUser();
    if (!systemUser?.githubAccessToken) {
      return NextResponse.json(
        { error: 'GitHub Access Token이 설정되지 않았습니다.' },
        { status: 401 }
      );
    }

    // GitHub에서 실제 웹훅 목록 조회
    let githubWebhooks: any[] = [];
    try {
      const octokit = new Octokit({
        auth: systemUser.githubAccessToken,
      });
      const { data } = await octokit.repos.listWebhooks({
        owner: project.repo_owner,
        repo: project.repo_name,
      });
      githubWebhooks = data;
    } catch (error) {
      console.error('Error listing webhooks:', error);
      return NextResponse.json(
        {
          error: 'GitHub 웹훅 목록을 가져올 수 없습니다.',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    // 현재 설정된 Webhook URL
    const expectedWebhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/github/webhook`;

    // DB에 저장된 webhook_id와 일치하는 웹훅 찾기
    const matchingWebhook = project.webhook_id
      ? githubWebhooks.find((wh) => wh.id === project.webhook_id)
      : null;

    // 예상 URL과 일치하는 웹훅 찾기
    const urlMatchingWebhook = githubWebhooks.length > 0
      ? githubWebhooks.find((wh) => wh.config?.url === expectedWebhookUrl)
      : null;

    return NextResponse.json({
      project: {
        id: project.id,
        repo_owner: project.repo_owner,
        repo_name: project.repo_name,
        webhook_id_in_db: project.webhook_id,
      },
      expected_webhook_url: expectedWebhookUrl,
      github_webhooks: githubWebhooks.map((wh) => ({
        id: wh.id,
        url: wh.config?.url,
        active: wh.active,
        events: wh.events,
        created_at: wh.created_at,
        updated_at: wh.updated_at,
      })),
      status: {
        webhook_exists: githubWebhooks.length > 0,
        db_webhook_id_matches: matchingWebhook !== null,
        url_matches: urlMatchingWebhook !== null,
        is_configured: matchingWebhook !== null || urlMatchingWebhook !== null,
      },
      matching_webhook: matchingWebhook
        ? {
            id: matchingWebhook.id,
            url: matchingWebhook.config?.url,
            active: matchingWebhook.active,
            events: matchingWebhook.events,
          }
        : urlMatchingWebhook
        ? {
            id: urlMatchingWebhook.id,
            url: urlMatchingWebhook.config?.url,
            active: urlMatchingWebhook.active,
            events: urlMatchingWebhook.events,
          }
        : null,
    });
  } catch (error) {
    console.error('Error in GET /api/projects/[id]/webhook-status:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

