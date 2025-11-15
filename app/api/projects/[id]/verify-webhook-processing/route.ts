import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * 웹훅 처리 결과를 상세히 확인하는 API
 * - 최근 업데이트된 파일의 청크 수 확인
 * - AI 분석 업데이트 여부 확인
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
      .select('id, repo_owner, repo_name')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 최근 1시간 이내 업데이트된 파일과 그 청크 수
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentFiles, error: filesError } = await supabaseAdmin
      .from('repo_files')
      .select('id, path, sha, updated_at, size')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .gte('updated_at', oneHourAgo)
      .order('updated_at', { ascending: false });

    // 각 파일의 청크 수 확인
    const filesWithChunks = await Promise.all(
      (recentFiles || []).map(async (file) => {
        const { count, error: chunksError } = await supabaseAdmin
          .from('repo_file_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('repo_file_id', file.id)
          .eq('is_current', true);

        return {
          ...file,
          chunk_count: count || 0,
          chunks_error: chunksError?.message,
        };
      })
    );

    // AI 분석 업데이트 시간 확인
    const { data: analysis, error: analysisError } = await supabaseAdmin
      .from('project_analysis')
      .select('updated_at, idea_review, tech_review, patent_review')
      .eq('project_id', projectId)
      .single();

    // 전체 청크 통계 (JOIN을 통해 project_id로 필터링)
    const { data: allChunks, error: totalChunksError } = await supabaseAdmin
      .from('repo_file_chunks')
      .select('id, repo_file_id, repo_files!inner(project_id)', { count: 'exact', head: false })
      .eq('repo_files.project_id', projectId)
      .eq('is_current', true);
    
    const totalChunks = allChunks?.length || 0;

    return NextResponse.json({
      project: {
        id: project.id,
        repo_owner: project.repo_owner,
        repo_name: project.repo_name,
      },
      recent_files: {
        count: filesWithChunks.length,
        files: filesWithChunks,
        total_chunks: filesWithChunks.reduce((sum, f) => sum + (f.chunk_count || 0), 0),
      },
      chunks_status: {
        total_current_chunks: totalChunks || 0,
        has_chunks: (totalChunks || 0) > 0,
        error: totalChunksError?.message,
      },
      ai_analysis: analysis
        ? {
            last_updated: analysis.updated_at,
            has_idea_review: !!analysis.idea_review,
            has_tech_review: !!analysis.tech_review,
            has_patent_review: !!analysis.patent_review,
            needs_update: new Date(analysis.updated_at) < new Date(oneHourAgo),
          }
        : { exists: false },
      summary: {
        files_updated: filesWithChunks.length > 0,
        chunks_created: filesWithChunks.some((f) => (f.chunk_count || 0) > 0),
        ai_analysis_outdated: analysis
          ? new Date(analysis.updated_at) < new Date(oneHourAgo)
          : true,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/projects/[id]/verify-webhook-processing:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

