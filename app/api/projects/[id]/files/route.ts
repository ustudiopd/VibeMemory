import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase, getSystemUser } from '@/lib/system-user';
import { getFileContent } from '@/lib/github';
import { downloadFileFromStorage } from '@/lib/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get('path');

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

    // 특정 파일 미리보기 요청
    if (path) {
      const systemUser = getSystemUser();
      if (!systemUser?.githubAccessToken) {
        return NextResponse.json(
          { error: 'GitHub Access Token이 설정되지 않았습니다.' },
          { status: 401 }
        );
      }

      try {
        // 파일 정보 조회
        const { data: repoFile } = await supabaseAdmin
          .from('repo_files')
          .select('sha, path, bucket_path')
          .eq('project_id', projectId)
          .eq('path', path)
          .eq('is_current', true)
          .single();

        let content: string | null = null;
        
        // Storage에서 파일 읽기 시도
        if (repoFile?.bucket_path) {
          content = await downloadFileFromStorage(repoFile.bucket_path);
        }
        
        // Storage에 없으면 GitHub에서 가져오기
        if (!content) {
          console.log(`[FILES] File not found in storage, fetching from GitHub: ${path}`);
          content = await getFileContent(
            systemUser.githubAccessToken,
            project.repo_owner,
            project.repo_name,
            path
          );
        }

        return NextResponse.json({
          content,
          path,
          sha: repoFile?.sha || null,
          bucket_path: repoFile?.bucket_path || null,
          github_url: repoFile?.sha
            ? `https://github.com/${project.repo_owner}/${project.repo_name}/blob/${repoFile.sha}/${path}`
            : null,
        });
      } catch (error) {
        return NextResponse.json(
          { error: 'Failed to fetch file content', details: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 }
        );
      }
    }

    // 파일 목록 조회 (.md 파일만, is_current = true인 파일만)
    const { data: files, error: filesError } = await supabaseAdmin
      .from('repo_files')
      .select('id, path, sha, size, is_current, created_at')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .like('path', '%.md')
      .order('path', { ascending: true });

    if (filesError) {
      return NextResponse.json(
        { error: 'Failed to fetch files', details: filesError.message },
        { status: 500 }
      );
    }

    // 각 파일에 대해 GitHub URL 생성
    const filesWithUrls = files.map((file) => ({
      ...file,
      github_url: `https://github.com/${project.repo_owner}/${project.repo_name}/blob/${file.sha}/${file.path}`,
    }));

    return NextResponse.json({ files: filesWithUrls });
  } catch (error) {
    console.error('Error in files API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

