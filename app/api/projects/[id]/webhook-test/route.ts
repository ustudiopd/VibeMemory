import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * 웹훅이 최근에 수신되었는지 확인하는 API
 * - 최근 업데이트된 파일 확인
 * - 최근 릴리즈 노트 확인
 * - job_locks에서 웹훅 작업 확인
 */
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

    // 최근 업데이트된 파일 (최근 1시간 이내)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentFiles, error: filesError } = await supabaseAdmin
      .from('repo_files')
      .select('path, sha, updated_at, size')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .gte('updated_at', oneHourAgo)
      .order('updated_at', { ascending: false })
      .limit(10);

    // 최근 릴리즈 노트 확인
    const { data: analysis, error: analysisError } = await supabaseAdmin
      .from('project_analysis')
      .select('latest_release_note, updated_at')
      .eq('project_id', projectId)
      .single();

    // 웹훅 작업 잠금 확인
    const jobName = `webhook:${project.repo_owner}/${project.repo_name}`;
    const { data: jobLock, error: lockError } = await supabaseAdmin
      .from('job_locks')
      .select('job_name, claimed_by, expires_at, created_at')
      .eq('job_name', jobName)
      .single();

    return NextResponse.json({
      project: {
        id: project.id,
        repo_owner: project.repo_owner,
        repo_name: project.repo_name,
        webhook_id: project.webhook_id,
      },
      recent_activity: {
        files_updated_last_hour: recentFiles?.length || 0,
        recent_files: recentFiles || [],
        has_recent_activity: (recentFiles?.length || 0) > 0,
      },
      release_note: analysis
        ? {
            exists: !!analysis.latest_release_note,
            updated_at: analysis.updated_at,
            preview: analysis.latest_release_note
              ? analysis.latest_release_note.substring(0, 200)
              : null,
          }
        : null,
      webhook_job_lock: jobLock
        ? {
            exists: true,
            claimed_by: jobLock.claimed_by,
            expires_at: jobLock.expires_at,
            created_at: jobLock.created_at,
            is_active: new Date(jobLock.expires_at) > new Date(),
          }
        : { exists: false },
      summary: {
        webhook_received_recently:
          (recentFiles?.length || 0) > 0 || (jobLock && new Date(jobLock.expires_at) > new Date()),
        last_file_update: recentFiles?.[0]?.updated_at || null,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/projects/[id]/webhook-test:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

