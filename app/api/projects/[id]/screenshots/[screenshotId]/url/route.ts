import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * GET /api/projects/[id]/screenshots/[screenshotId]/url
 * 스크린샷 이미지 URL 가져오기 (signed URL)
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
      .select('id, storage_path')
      .eq('id', screenshotId)
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .single();

    if (screenshotError || !screenshot || !screenshot.storage_path) {
      return NextResponse.json(
        { error: '스크린샷을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // Signed URL 생성 (60초 유효)
    const { data: signedUrlData, error: urlError } = await supabaseAdmin.storage
      .from('project-screenshots')
      .createSignedUrl(screenshot.storage_path, 60);

    if (urlError || !signedUrlData) {
      console.error('[SCREENSHOTS] Error creating signed URL:', urlError);
      return NextResponse.json(
        { error: '이미지 URL 생성에 실패했습니다.', details: urlError?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      url: signedUrlData.signedUrl,
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

