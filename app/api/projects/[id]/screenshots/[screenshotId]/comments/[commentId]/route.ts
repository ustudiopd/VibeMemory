import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * DELETE /api/projects/[id]/screenshots/[screenshotId]/comments/[commentId]
 * 댓글 삭제 (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; screenshotId: string; commentId: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId, screenshotId, commentId } = await params;

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

    // 댓글 소유 확인
    const { data: comment, error: commentError } = await supabaseAdmin
      .from('screenshot_comments')
      .select('id, screenshot_id, author_id')
      .eq('id', commentId)
      .eq('screenshot_id', screenshotId)
      .eq('author_id', user.id)
      .is('deleted_at', null)
      .single();

    if (commentError || !comment) {
      return NextResponse.json(
        { error: '댓글을 찾을 수 없거나 삭제 권한이 없습니다.' },
        { status: 404 }
      );
    }

    // Soft delete
    const { error: deleteError } = await supabaseAdmin
      .from('screenshot_comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', commentId);

    if (deleteError) {
      console.error('[COMMENTS] Error deleting comment:', deleteError);
      return NextResponse.json(
        { error: '댓글 삭제에 실패했습니다.', details: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '댓글이 삭제되었습니다.',
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

