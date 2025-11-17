import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { deleteScreenshot } from '@/lib/storage';

/**
 * PATCH /api/projects/[id]/screenshots/[screenshotId]
 * 스크린샷 메타데이터 업데이트
 */
export async function PATCH(
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

    // 스크린샷 소유 확인
    const { data: screenshot, error: screenshotError } = await supabaseAdmin
      .from('project_screenshots')
      .select('id, project_id, owner_id')
      .eq('id', screenshotId)
      .eq('project_id', projectId)
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .single();

    if (screenshotError || !screenshot) {
      return NextResponse.json(
        { error: '스크린샷을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 업데이트할 필드만 추출
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (body.caption !== undefined) updateData.caption = body.caption;
    if (body.alt_text !== undefined) updateData.alt_text = body.alt_text;
    if (body.position !== undefined) updateData.position = body.position;
    if (body.visibility !== undefined) updateData.visibility = body.visibility;
    if (body.width !== undefined) updateData.width = body.width;
    if (body.height !== undefined) updateData.height = body.height;

    // is_primary 업데이트 처리
    if (body.is_primary !== undefined) {
      if (body.is_primary === true) {
        // 대표 이미지로 설정하는 경우, 같은 프로젝트의 다른 스크린샷은 모두 false로 변경
        await supabaseAdmin
          .from('project_screenshots')
          .update({ is_primary: false, updated_at: new Date().toISOString() })
          .eq('project_id', projectId)
          .neq('id', screenshotId)
          .is('deleted_at', null);
      }
      updateData.is_primary = body.is_primary;
    }

    // 업데이트
    const { data: updatedScreenshot, error: updateError } = await supabaseAdmin
      .from('project_screenshots')
      .update(updateData)
      .eq('id', screenshotId)
      .select()
      .single();

    if (updateError) {
      console.error('[SCREENSHOTS] Error updating screenshot:', updateError);
      return NextResponse.json(
        { error: '스크린샷 업데이트에 실패했습니다.', details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      screenshot: updatedScreenshot,
    });
  } catch (error) {
    console.error('[SCREENSHOTS] Error:', error);
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
 * DELETE /api/projects/[id]/screenshots/[screenshotId]
 * 스크린샷 삭제 (soft delete)
 */
export async function DELETE(
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

    // 스크린샷 소유 확인 및 조회
    const { data: screenshot, error: screenshotError } = await supabaseAdmin
      .from('project_screenshots')
      .select('id, project_id, owner_id, storage_path')
      .eq('id', screenshotId)
      .eq('project_id', projectId)
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .single();

    if (screenshotError || !screenshot) {
      return NextResponse.json(
        { error: '스크린샷을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // Soft delete (deleted_at 설정)
    const { error: deleteError } = await supabaseAdmin
      .from('project_screenshots')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', screenshotId);

    if (deleteError) {
      console.error('[SCREENSHOTS] Error deleting screenshot:', deleteError);
      return NextResponse.json(
        { error: '스크린샷 삭제에 실패했습니다.', details: deleteError.message },
        { status: 500 }
      );
    }

    // Storage에서 실제 파일 삭제 (선택적, 나중에 배치 작업으로 처리 가능)
    if (screenshot.storage_path) {
      await deleteScreenshot(screenshot.storage_path).catch((err) => {
        console.error('[SCREENSHOTS] Error deleting file from storage:', err);
        // Storage 삭제 실패해도 DB 삭제는 성공했으므로 계속 진행
      });
    }

    return NextResponse.json({
      success: true,
      message: '스크린샷이 삭제되었습니다.',
    });
  } catch (error) {
    console.error('[SCREENSHOTS] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

