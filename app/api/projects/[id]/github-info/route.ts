import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase, getSystemUser } from '@/lib/system-user';
import { getRepositoryInfo } from '@/lib/github';

/**
 * 프로젝트의 GitHub 기본 정보를 가져오는 API
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
      .select('id, repo_owner, repo_name')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // GitHub Access Token 가져오기
    const systemUser = getSystemUser();
    if (!systemUser?.githubAccessToken) {
      return NextResponse.json(
        { error: 'GitHub Access Token이 설정되지 않았습니다.' },
        { status: 401 }
      );
    }

    // 저장소 정보 가져오기
    const repoInfo = await getRepositoryInfo(
      systemUser.githubAccessToken,
      project.repo_owner,
      project.repo_name
    );

    return NextResponse.json({
      name: repoInfo.name,
      full_name: repoInfo.full_name,
      description: repoInfo.description || '',
      homepage: repoInfo.homepage || '',
      html_url: repoInfo.html_url,
      language: repoInfo.language || '',
      stargazers_count: repoInfo.stargazers_count || 0,
      forks_count: repoInfo.forks_count || 0,
      default_branch: repoInfo.default_branch || 'main',
      created_at: repoInfo.created_at,
      updated_at: repoInfo.updated_at,
      pushed_at: repoInfo.pushed_at,
    });
  } catch (error) {
    console.error('Error in GET /api/projects/[id]/github-info:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

