import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase, getSystemUser } from '@/lib/system-user';
import { Octokit } from '@octokit/rest';

export async function POST(
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

    // 이미 웹훅이 있는지 확인
    if (project.webhook_id) {
      return NextResponse.json(
        { 
          error: '이미 웹훅이 등록되어 있습니다.',
          webhook_id: project.webhook_id 
        },
        { status: 409 }
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

    // 환경 변수 확인
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/github/webhook`;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return NextResponse.json(
        { error: 'GITHUB_WEBHOOK_SECRET 환경 변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    // GitHub에 웹훅 생성
    let webhookId: number | null = null;
    try {
      const octokit = new Octokit({
        auth: systemUser.githubAccessToken,
      });

      const { data: webhook } = await octokit.repos.createWebhook({
        owner: project.repo_owner,
        repo: project.repo_name,
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: webhookSecret,
          insecure_ssl: '0',
        },
        events: ['push'],
        active: true,
      });

      webhookId = webhook.id;
    } catch (error: any) {
      console.error('Error creating webhook:', error);
      
      // 이미 존재하는 웹훅인 경우 (422 에러)
      if (error.status === 422) {
        return NextResponse.json(
          { 
            error: '웹훅 생성에 실패했습니다. 이미 동일한 URL의 웹훅이 존재할 수 있습니다.',
            details: error.message 
          },
          { status: 422 }
        );
      }

      return NextResponse.json(
        {
          error: 'GitHub 웹훅 생성에 실패했습니다.',
          details: error.message || 'Unknown error',
        },
        { status: 500 }
      );
    }

    // DB에 웹훅 ID 업데이트
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({ webhook_id: webhookId })
      .eq('id', projectId);

    if (updateError) {
      console.error('Error updating webhook_id in database:', updateError);
      // 웹훅은 생성되었지만 DB 업데이트 실패 - 경고만 표시
    }

    return NextResponse.json({
      success: true,
      message: '웹훅이 성공적으로 생성되었습니다.',
      webhook: {
        id: webhookId,
        url: webhookUrl,
        repo_owner: project.repo_owner,
        repo_name: project.repo_name,
      },
    });
  } catch (error) {
    console.error('Error in POST /api/projects/[id]/create-webhook:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

