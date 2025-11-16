import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * GET /api/projects/[id]/chat/sessions/[sessionId]/messages
 * 세션의 메시지 목록 조회 (페이지네이션)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId, sessionId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const cursor = searchParams.get('cursor'); // created_at 기준 커서

    // 프로젝트 및 세션 소유 확인
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, project_id, owner_id')
      .eq('id', sessionId)
      .eq('project_id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: '세션을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 메시지 조회 (Citations 포함, 커서 기반 페이지네이션)
    let query = supabaseAdmin
      .from('chat_messages')
      .select(`
        id, 
        role, 
        content, 
        model, 
        tokens_input, 
        tokens_output, 
        error, 
        created_at,
        chat_message_citations (
          id,
          file_path,
          chunk_id,
          score
        )
      `)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (cursor) {
      query = query.gt('created_at', cursor);
    }

    const { data: messages, error: messagesError } = await query;

    if (messagesError) {
      console.error('[MESSAGES] Error fetching messages:', messagesError);
      return NextResponse.json(
        { error: '메시지를 가져올 수 없습니다.', details: messagesError.message },
        { status: 500 }
      );
    }

    // 응답 형식 변환: Citations를 sources 배열로 변환
    const messagesWithSources = (messages || []).map((msg: any) => {
      // Citations가 있으면 sources로 변환, 없으면 기존 sources jsonb 사용 (하위 호환)
      const sources = msg.chat_message_citations && msg.chat_message_citations.length > 0
        ? msg.chat_message_citations.map((citation: any) => ({
            file_path: citation.file_path,
            chunk_id: citation.chunk_id,
            score: citation.score,
          }))
        : (msg.sources || []); // 기존 jsonb 데이터 (하위 호환)

      return {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        model: msg.model,
        tokens_input: msg.tokens_input,
        tokens_output: msg.tokens_output,
        error: msg.error,
        created_at: msg.created_at,
        sources,
      };
    });

    // 다음 커서 계산
    const nextCursor =
      messages && messages.length === limit
        ? messages[messages.length - 1].created_at
        : null;

    return NextResponse.json({
      messages: messagesWithSources,
      nextCursor,
    });
  } catch (error) {
    console.error('[MESSAGES] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

