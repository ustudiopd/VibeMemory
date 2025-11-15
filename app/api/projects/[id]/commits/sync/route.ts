import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase, getSystemUser } from '@/lib/system-user';
import { getRepositoryCommits } from '@/lib/github';

/**
 * 프로젝트의 커밋 히스토리를 GitHub에서 가져와서 데이터베이스에 동기화하는 API
 */
export async function POST(
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
    const perPage = parseInt(searchParams.get('per_page') || '100', 10);

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

    // GitHub에서 커밋 히스토리 가져오기
    const commits = await getRepositoryCommits(
      systemUser.githubAccessToken,
      project.repo_owner,
      project.repo_name,
      perPage
    );

    // 커밋 정보를 commit_history 테이블에 저장
    const commitRecords = commits.map((commit: any) => ({
      project_id: projectId,
      sha: commit.sha,
      message: commit.commit.message || '',
      author_name: commit.commit.author?.name || commit.author?.login || '',
      author_email: commit.commit.author?.email || '',
      author_login: commit.author?.login || '',
      author_avatar_url: commit.author?.avatar_url || '',
      commit_date: commit.commit.author?.date || commit.commit.committer?.date || new Date().toISOString(),
      commit_url: commit.html_url || `https://github.com/${project.repo_owner}/${project.repo_name}/commit/${commit.sha}`,
    }));

    // UPSERT로 저장 (중복 방지)
    let savedCount = 0;
    let errorCount = 0;

    for (const commitRecord of commitRecords) {
      const { error: upsertError } = await supabaseAdmin
        .from('commit_history')
        .upsert(commitRecord, {
          onConflict: 'project_id,sha',
          ignoreDuplicates: false,
        });
      
      if (upsertError) {
        console.error(`Error upserting commit ${commitRecord.sha}:`, upsertError);
        errorCount++;
      } else {
        savedCount++;
      }
    }

    return NextResponse.json({
      message: '커밋 히스토리가 업데이트되었습니다.',
      total: commitRecords.length,
      saved: savedCount,
      errors: errorCount,
    });
  } catch (error) {
    console.error('Error in POST /api/projects/[id]/commits/sync:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

