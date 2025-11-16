import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * GET /api/projects/[id]/chunks/[chunkId]
 * 특정 청크 내용 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chunkId: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId, chunkId } = await params;

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

    // 청크 조회 (프로젝트 소유 확인 포함)
    const { data: chunk, error: chunkError } = await supabaseAdmin
      .from('repo_file_chunks')
      .select(`
        id,
        content,
        chunk_index,
        repo_files!inner (
          id,
          path,
          project_id
        )
      `)
      .eq('id', chunkId)
      .eq('repo_files.project_id', projectId)
      .eq('is_current', true)
      .single();

    if (chunkError || !chunk) {
      return NextResponse.json(
        { error: '청크를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: chunk.id,
      content: chunk.content,
      chunk_index: chunk.chunk_index,
      file_path: (chunk.repo_files as any).path,
    });
  } catch (error) {
    console.error('[CHUNK] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

