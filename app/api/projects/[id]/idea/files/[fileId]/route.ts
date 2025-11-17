import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

const IDEA_FILES_BUCKET_NAME = 'idea-project-files';

/**
 * GET /api/projects/[id]/idea/files/[fileId]
 * 아이디어 프로젝트 파일 내용 조회 (미리보기용)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId, fileId } = await params;

    // 프로젝트 소유 확인
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, project_type, owner_id')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    if (project.project_type !== 'idea') {
      return NextResponse.json(
        { error: '이 API는 아이디어 프로젝트 전용입니다.' },
        { status: 400 }
      );
    }

    // 파일 정보 조회
    const { data: file, error: fileError } = await supabaseAdmin
      .from('idea_project_files')
      .select('id, file_name, file_type, storage_path, mime_type')
      .eq('id', fileId)
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .single();

    if (fileError || !file) {
      return NextResponse.json(
        { error: '파일을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // txt, md 파일만 미리보기 가능
    const ext = file.file_name?.split('.').pop()?.toLowerCase();
    if (ext !== 'txt' && ext !== 'md') {
      return NextResponse.json(
        { error: '이 파일 형식은 미리보기를 지원하지 않습니다. (txt, md 파일만 지원)' },
        { status: 400 }
      );
    }

    // Storage에서 파일 내용 읽기
    if (!file.storage_path) {
      return NextResponse.json(
        { error: '파일 경로를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    try {
      const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from(IDEA_FILES_BUCKET_NAME)
        .download(file.storage_path);

      if (downloadError || !fileData) {
        console.error('[IDEA FILES] Error downloading file:', downloadError);
        return NextResponse.json(
          { error: '파일을 읽을 수 없습니다.', details: downloadError?.message },
          { status: 500 }
        );
      }

      const content = await fileData.text();

      return NextResponse.json({
        success: true,
        file_name: file.file_name,
        file_type: file.file_type,
        mime_type: file.mime_type,
        content: content,
      });
    } catch (error) {
      console.error('[IDEA FILES] Error reading file:', error);
      return NextResponse.json(
        {
          error: '파일을 읽는 중 오류가 발생했습니다.',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[IDEA FILES] Error:', error);
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
 * DELETE /api/projects/[id]/idea/files/[fileId]
 * 아이디어 프로젝트 파일 삭제 (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId, fileId } = await params;

    // 프로젝트 소유 확인
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, project_type, owner_id')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    if (project.project_type !== 'idea') {
      return NextResponse.json(
        { error: '이 API는 아이디어 프로젝트 전용입니다.' },
        { status: 400 }
      );
    }

    // 파일 정보 조회
    const { data: file, error: fileError } = await supabaseAdmin
      .from('idea_project_files')
      .select('id, storage_path, project_id')
      .eq('id', fileId)
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .single();

    if (fileError || !file) {
      return NextResponse.json(
        { error: '파일을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 1. 관련 청크 삭제 (CASCADE로 자동 삭제되지만 명시적으로 삭제)
    const { error: chunksDeleteError } = await supabaseAdmin
      .from('idea_project_chunks')
      .delete()
      .eq('file_id', fileId);

    if (chunksDeleteError) {
      console.error('[IDEA FILES] Error deleting chunks:', chunksDeleteError);
      // 청크 삭제 실패해도 파일 삭제는 계속 진행
    } else {
      console.log('[IDEA FILES] Deleted chunks for file:', fileId);
    }

    // 2. Storage에서 파일 삭제
    if (file.storage_path) {
      try {
        const { error: storageError } = await supabaseAdmin.storage
          .from(IDEA_FILES_BUCKET_NAME)
          .remove([file.storage_path]);

        if (storageError) {
          console.error('[IDEA FILES] Error deleting file from storage:', storageError);
          // Storage 삭제 실패해도 DB 삭제는 계속 진행
        } else {
          console.log('[IDEA FILES] Deleted file from storage:', file.storage_path);
        }
      } catch (storageErr) {
        console.error('[IDEA FILES] Exception deleting file from storage:', storageErr);
        // Storage 삭제 실패해도 DB 삭제는 계속 진행
      }
    }

    // 3. 파일 메타데이터 soft delete (deleted_at 설정)
    const { error: deleteError } = await supabaseAdmin
      .from('idea_project_files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', fileId)
      .eq('project_id', projectId);

    if (deleteError) {
      console.error('[IDEA FILES] Error deleting file metadata:', deleteError);
      return NextResponse.json(
        { 
          error: '파일 삭제에 실패했습니다.', 
          details: deleteError.message 
        },
        { status: 500 }
      );
    }

    console.log('[IDEA FILES] Successfully deleted file:', fileId);

    return NextResponse.json({
      success: true,
      message: '파일이 삭제되었습니다.',
    });
  } catch (error) {
    console.error('[IDEA FILES] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

