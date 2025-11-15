import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase, getSystemUser } from '@/lib/system-user';
import { getRepositoryCommits } from '@/lib/github';

/**
 * 프로젝트의 GitHub 커밋 히스토리를 가져오는 API
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
    const searchParams = request.nextUrl.searchParams;
    const perPage = parseInt(searchParams.get('per_page') || '30', 10);

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

    // 저장된 커밋 히스토리 조회 (웹훅으로 저장된 데이터)
    const { data: savedCommits, error: commitsError } = await supabaseAdmin
      .from('commit_history')
      .select('*')
      .eq('project_id', projectId)
      .order('commit_date', { ascending: false })
      .limit(perPage);

    if (commitsError) {
      console.error('Error fetching commit history:', commitsError);
      return NextResponse.json(
        { error: '커밋 히스토리를 가져올 수 없습니다.', details: commitsError.message },
        { status: 500 }
      );
    }

    // 커밋 데이터 포맷팅
    const formattedCommits = (savedCommits || []).map((commit: any) => ({
      sha: commit.sha,
      message: commit.message,
      author: {
        name: commit.author_name || 'Unknown',
        email: commit.author_email || '',
        avatar: commit.author_avatar_url || '',
        login: commit.author_login || '',
      },
      date: commit.commit_date,
      url: commit.commit_url,
    }));

    return NextResponse.json({ commits: formattedCommits });
  } catch (error) {
    console.error('Error in GET /api/projects/[id]/commits:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

