import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * 프로젝트 개요를 가져오는 API
 * project_analysis 테이블에 저장된 값을 조회 (AI 분석 시 함께 생성됨)
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

    // project_analysis 테이블에서 저장된 프로젝트 개요 조회
    const { data: analysis, error: analysisError } = await supabaseAdmin
      .from('project_analysis')
      .select('project_overview')
      .eq('project_id', projectId)
      .single();

    if (analysisError && analysisError.code !== 'PGRST116') {
      // PGRST116 is "not found" error, which is OK
      console.error('[OVERVIEW] Error fetching project overview:', analysisError);
      return NextResponse.json(
        { error: '프로젝트 개요를 가져올 수 없습니다.', details: analysisError.message },
        { status: 500 }
      );
    }

    // 저장된 개요가 있으면 반환, 없으면 기본 메시지
    const overview = analysis?.project_overview || `${project.repo_name}는 ${project.repo_owner}에서 개발 중인 프로젝트입니다.`;

    return NextResponse.json({
      overview: overview.trim(),
      source_file: null, // 저장된 값이므로 source_file 정보 없음
    });
  } catch (error) {
    console.error('Error in GET /api/projects/[id]/overview:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

