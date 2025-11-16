import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * PATCH /api/projects/[id]/screenshots/reorder
 * 스크린샷 순서 변경
 */
export async function PATCH(
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
    const { items } = body; // [{id, position}, ...]

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'items 배열이 필요합니다.' },
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

    // 모든 스크린샷 ID가 해당 프로젝트에 속하는지 확인
    const screenshotIds = items.map((item: any) => item.id);
    const { data: screenshots, error: checkError } = await supabaseAdmin
      .from('project_screenshots')
      .select('id')
      .eq('project_id', projectId)
      .eq('owner_id', user.id)
      .in('id', screenshotIds)
      .is('deleted_at', null);

    if (checkError || !screenshots || screenshots.length !== items.length) {
      return NextResponse.json(
        { error: '일부 스크린샷을 찾을 수 없거나 권한이 없습니다.' },
        { status: 404 }
      );
    }

    // 각 스크린샷의 position 업데이트
    const updates = items.map((item: any) =>
      supabaseAdmin
        .from('project_screenshots')
        .update({
          position: item.position,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('project_id', projectId)
        .eq('owner_id', user.id)
    );

    const results = await Promise.all(updates);
    const errors = results.filter((result) => result.error);

    if (errors.length > 0) {
      console.error('[SCREENSHOTS] Error reordering screenshots:', errors);
      return NextResponse.json(
        { error: '일부 스크린샷 순서 변경에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '스크린샷 순서가 변경되었습니다.',
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

