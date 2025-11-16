import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * GET /api/projects/[id]/screenshots/[screenshotId]/comments
 * 댓글 목록 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; screenshotId: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId, screenshotId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const cursor = searchParams.get('cursor');

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

    // 스크린샷 확인
    const { data: screenshot, error: screenshotError } = await supabaseAdmin
      .from('project_screenshots')
      .select('id')
      .eq('id', screenshotId)
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .single();

    if (screenshotError || !screenshot) {
      return NextResponse.json(
        { error: '스크린샷을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 댓글 목록 조회
    let query = supabaseAdmin
      .from('screenshot_comments')
      .select('*')
      .eq('screenshot_id', screenshotId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (cursor) {
      query = query.gt('created_at', cursor);
    } else {
      query = query.range(offset, offset + limit - 1);
    }

    const { data: comments, error } = await query;

    if (error) {
      console.error('[COMMENTS] Error fetching comments:', error);
      return NextResponse.json(
        { error: '댓글 목록을 가져올 수 없습니다.', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      comments: comments || [],
      hasMore: (comments || []).length === limit,
    });
  } catch (error) {
    console.error('[COMMENTS] Error:', error);
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
 * POST /api/projects/[id]/screenshots/[screenshotId]/comments
 * 댓글 작성
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; screenshotId: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId, screenshotId } = await params;
    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json(
        { error: '댓글 내용이 필요합니다.' },
        { status: 400 }
      );
    }

    // 길이 제한 (2,000자)
    if (content.length > 2000) {
      return NextResponse.json(
        { error: '댓글은 2,000자를 초과할 수 없습니다.' },
        { status: 400 }
      );
    }

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

    // 스크린샷 확인
    const { data: screenshot, error: screenshotError } = await supabaseAdmin
      .from('project_screenshots')
      .select('id')
      .eq('id', screenshotId)
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .single();

    if (screenshotError || !screenshot) {
      return NextResponse.json(
        { error: '스크린샷을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 댓글 생성
    // TODO: XSS 방지를 위한 마크다운 sanitize 추가 권장
    const { data: comment, error: insertError } = await supabaseAdmin
      .from('screenshot_comments')
      .insert({
        screenshot_id: screenshotId,
        project_id: projectId,
        author_id: user.id,
        content: content.trim(),
      })
      .select()
      .single();

    if (insertError || !comment) {
      console.error('[COMMENTS] Error creating comment:', insertError);
      return NextResponse.json(
        { error: '댓글 작성에 실패했습니다.', details: insertError?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      comment: comment,
    });
  } catch (error) {
    console.error('[COMMENTS] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

