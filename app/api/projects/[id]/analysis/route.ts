import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { getSystemUser } from '@/lib/system-user';
import { analyzeProject } from '@/lib/analysisService';

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

    // Verify project ownership
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, owner_id')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Fetch project analysis
    const { data: analysis, error: analysisError } = await supabaseAdmin
      .from('project_analysis')
      .select('*')
      .eq('project_id', projectId)
      .single();

    if (analysisError && analysisError.code !== 'PGRST116') {
      // PGRST116 is "not found" error, which is OK
      console.error('Error fetching project analysis:', analysisError);
      return NextResponse.json(
        { error: 'Failed to fetch project analysis', details: analysisError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ analysis: analysis || null });
  } catch (error) {
    console.error('Error in GET /api/projects/[id]/analysis:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

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

    // 프로젝트 정보 확인
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, owner_id, repo_owner, repo_name')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const systemUser = getSystemUser();
    if (!systemUser?.githubAccessToken) {
      return NextResponse.json(
        { error: 'GitHub Access Token이 설정되지 않았습니다.' },
        { status: 401 }
      );
    }

    console.log(`[MANUAL AI ANALYSIS] Starting AI analysis for project ${projectId}`);

    // AI 분석 실행 (runId 없이 실행 - 진행률 추적 없음)
    await analyzeProject(
      projectId,
      systemUser.githubAccessToken,
      project.repo_owner,
      project.repo_name
    );

    // 결과 조회
    const { data: analysis, error: analysisError } = await supabaseAdmin
      .from('project_analysis')
      .select('*')
      .eq('project_id', projectId)
      .single();

    if (analysisError && analysisError.code !== 'PGRST116') {
      console.error('Error fetching project analysis after completion:', analysisError);
      return NextResponse.json(
        { 
          error: 'AI 분석은 완료되었지만 결과를 조회할 수 없습니다.', 
          details: analysisError.message 
        },
        { status: 500 }
      );
    }

    console.log(`[MANUAL AI ANALYSIS] Completed for project ${projectId}`);

    return NextResponse.json({ 
      message: 'AI 분석이 완료되었습니다.',
      analysis: analysis || null 
    });
  } catch (error) {
    console.error('Error in POST /api/projects/[id]/analysis:', error);
    return NextResponse.json(
      {
        error: 'AI 분석 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

