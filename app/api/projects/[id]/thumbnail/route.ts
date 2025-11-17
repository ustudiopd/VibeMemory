import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * GET /api/projects/[id]/thumbnail
 * 프로젝트의 대표 이미지 썸네일 URL 가져오기 (signed URL)
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

    // 대표 이미지 조회
    const { data: primaryScreenshot, error: screenshotError } = await supabaseAdmin
      .from('project_screenshots')
      .select('id, storage_path')
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .is('deleted_at', null)
      .single();

    if (screenshotError || !primaryScreenshot || !primaryScreenshot.storage_path) {
      // 대표 이미지가 없으면 null 반환 (에러 아님)
      return NextResponse.json({
        url: null,
      });
    }

    // Signed URL 생성 (1시간 유효)
    const { data: signedUrlData, error: urlError } = await supabaseAdmin.storage
      .from('project-screenshots')
      .createSignedUrl(primaryScreenshot.storage_path, 3600);

    if (urlError || !signedUrlData) {
      console.error('[THUMBNAIL] Error creating signed URL:', urlError);
      return NextResponse.json(
        { error: '썸네일 URL 생성에 실패했습니다.', details: urlError?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      url: signedUrlData.signedUrl,
    });
  } catch (error) {
    console.error('[THUMBNAIL] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

