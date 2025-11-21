import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { uploadScreenshot } from '@/lib/storage';

/**
 * GET /api/projects/[id]/screenshots
 * 스크린샷 목록 조회
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
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const cursor = searchParams.get('cursor');

    // 프로젝트 소유 확인 (public 뷰 사용)
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (projectError || !project) {
      console.error('[SCREENSHOTS] Project not found:', {
        projectId,
        ownerId: user.id,
        error: projectError,
        errorCode: projectError?.code,
        errorMessage: projectError?.message,
      });
      return NextResponse.json(
        { 
          error: '프로젝트를 찾을 수 없습니다.',
          details: projectError?.message || 'Unknown error',
          code: projectError?.code,
        },
        { status: 404 }
      );
    }

    // 스크린샷 목록 조회 (soft delete 제외, public 뷰 사용)
    let query = supabaseAdmin
      .from('project_screenshots')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (cursor) {
      query = query.lt('created_at', cursor);
    } else {
      query = query.range(offset, offset + limit - 1);
    }

    const { data: screenshots, error } = await query;

    if (error) {
      console.error('[SCREENSHOTS] Error fetching screenshots:', error);
      return NextResponse.json(
        { error: '스크린샷 목록을 가져올 수 없습니다.', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      screenshots: screenshots || [],
      hasMore: (screenshots || []).length === limit,
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
 * POST /api/projects/[id]/screenshots
 * 스크린샷 업로드 (서버에서 처리)
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

    // 프로젝트 소유 확인 (public 뷰 사용)
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (projectError || !project) {
      console.error('[SCREENSHOTS POST] Project not found:', {
        projectId,
        ownerId: user.id,
        error: projectError,
        errorCode: projectError?.code,
        errorMessage: projectError?.message,
      });
      return NextResponse.json(
        { 
          error: '프로젝트를 찾을 수 없습니다.',
          details: projectError?.message || 'Unknown error',
          code: projectError?.code,
        },
        { status: 404 }
      );
    }

    // FormData 파싱
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const caption = formData.get('caption') as string | null;
    const altText = formData.get('alt_text') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: '파일이 필요합니다.' },
        { status: 400 }
      );
    }

    // 파일 타입 검증
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: '이미지 파일만 업로드할 수 있습니다.' },
        { status: 400 }
      );
    }

    // 파일 크기 제한 (10MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: '파일 크기는 10MB를 초과할 수 없습니다.' },
        { status: 400 }
      );
    }

    // 파일을 버퍼로 변환
    let arrayBuffer: ArrayBuffer;
    let buffer: Buffer;
    
    try {
      arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      console.log('[SCREENSHOTS] File converted to buffer:', {
        originalSize: file.size,
        bufferSize: buffer.length,
        mimeType: file.type,
      });
    } catch (error) {
      console.error('[SCREENSHOTS] Error converting file to buffer:', error);
      return NextResponse.json(
        { 
          error: '파일 처리에 실패했습니다.',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    // 이미지 크기 추출 (간단한 방법, 실제로는 sharp 등 사용 권장)
    let width: number | null = null;
    let height: number | null = null;
    // TODO: 이미지 크기 추출 로직 추가 (sharp 라이브러리 사용 권장)

    // DB에 스크린샷 메타데이터 생성 (public 뷰 사용)
    console.log('[SCREENSHOTS] Creating screenshot record in DB...');
    const { data: screenshot, error: insertError } = await supabaseAdmin
      .from('project_screenshots')
      .insert({
        project_id: projectId,
        owner_id: user.id,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        width: width,
        height: height,
        caption: caption || null,
        alt_text: altText || null,
        storage_path: '', // 업로드 후 업데이트
      })
      .select()
      .single();

    if (insertError || !screenshot) {
      console.error('[SCREENSHOTS] Error creating screenshot record:', insertError);
      console.error('[SCREENSHOTS] Insert error details:', JSON.stringify(insertError, null, 2));
      return NextResponse.json(
        { 
          error: '스크린샷 메타데이터 생성에 실패했습니다.', 
          details: insertError?.message || 'Unknown error',
          code: insertError?.code,
        },
        { status: 500 }
      );
    }

    console.log('[SCREENSHOTS] Screenshot record created:', screenshot.id);

    // Storage에 업로드
    console.log('[SCREENSHOTS] Uploading to storage...', {
      projectId,
      screenshotId: screenshot.id,
      filename: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });

    // 버킷 존재 여부를 먼저 확인
    console.log('[SCREENSHOTS] Checking bucket before upload...');
    const { data: buckets, error: bucketCheckError } = await supabaseAdmin.storage.listBuckets();
    if (bucketCheckError) {
      console.error('[SCREENSHOTS] Error checking buckets:', bucketCheckError);
    } else {
      console.log('[SCREENSHOTS] Available buckets:', buckets?.map(b => b.name).join(', ') || 'none');
      const bucketExists = buckets?.some(b => b.name === 'project-screenshots') ?? false;
      console.log('[SCREENSHOTS] project-screenshots bucket exists:', bucketExists);
    }

    const storagePath = await uploadScreenshot(
      projectId,
      screenshot.id,
      file.name,
      buffer,
      file.type
    );

    if (!storagePath) {
      console.error('[SCREENSHOTS] Storage upload failed, cleaning up DB record...');
      // 업로드 실패 시 DB 레코드 삭제 (public 뷰 사용)
      await supabaseAdmin
        .from('project_screenshots')
        .delete()
        .eq('id', screenshot.id);
      
      // 버킷 상태 재확인
      const { data: finalBuckets } = await supabaseAdmin.storage.listBuckets();
      const finalBucketExists = finalBuckets?.some(b => b.name === 'project-screenshots') ?? false;
      
      return NextResponse.json(
        { 
          error: '스크린샷 업로드에 실패했습니다.',
          details: finalBucketExists 
            ? '버킷은 존재하지만 업로드에 실패했습니다. 서버 로그를 확인해주세요.'
            : `Storage 버킷('project-screenshots')이 존재하지 않습니다. Supabase Dashboard에서 버킷을 생성해주세요: Storage > Buckets > New bucket`,
          bucketExists: finalBucketExists,
          availableBuckets: finalBuckets?.map(b => b.name) || [],
        },
        { status: 500 }
      );
    }

    console.log('[SCREENSHOTS] Storage upload successful:', storagePath);

    // Storage 경로 업데이트 (public 뷰 사용)
    const { data: updatedScreenshot, error: updateError } = await supabaseAdmin
      .from('project_screenshots')
      .update({ storage_path: storagePath })
      .eq('id', screenshot.id)
      .select()
      .single();

    if (updateError || !updatedScreenshot) {
      console.error('[SCREENSHOTS] Error updating storage path:', updateError);
      // 업로드는 성공했으므로 경고만 로그
    }

    return NextResponse.json({
      success: true,
      screenshot: updatedScreenshot || screenshot,
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

