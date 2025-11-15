import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * POST /api/projects/[id]/chat/session
 * 새 세션 생성
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
    const body = await request.json();
    const { title } = body;

    // 프로젝트 소유 확인
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, repo_name')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 세션 생성 (타이틀 자동 생성)
    const sessionTitle = title || `${project.repo_name} - ${new Date().toLocaleDateString('ko-KR')}`;

    const { data: session, error: sessionError } = await supabaseAdmin
      .from('chat_sessions')
      .insert({
        project_id: projectId,
        owner_id: user.id,
        title: sessionTitle,
      })
      .select()
      .single();

    if (sessionError) {
      console.error('[SESSION] Error creating session:', sessionError);
      return NextResponse.json(
        { error: '세션 생성에 실패했습니다.', details: sessionError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ sessionId: session.id, session });
  } catch (error) {
    console.error('[SESSION] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/projects/[id]/chat/sessions
 * 세션 목록 조회 (최신 순)
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
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // 프로젝트 소유 확인
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 세션 목록 조회
    const { data: sessions, error: sessionsError } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, title, created_at, updated_at')
      .eq('project_id', projectId)
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (sessionsError) {
      console.error('[SESSION] Error fetching sessions:', sessionsError);
      return NextResponse.json(
        { error: '세션 목록을 가져올 수 없습니다.', details: sessionsError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ sessions: sessions || [] });
  } catch (error) {
    console.error('[SESSION] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

