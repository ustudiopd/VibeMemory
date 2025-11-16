import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { chunkText, embedChunks } from '@/lib/rag';
import { ensureIdeaFilesBucketExists, uploadIdeaFile } from '@/lib/storage';

const IDEA_FILES_BUCKET = 'idea-project-files';

/**
 * GET /api/projects/[id]/idea/files
 * 아이디어 프로젝트 파일 목록 조회
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

    // 파일 목록 조회
    const { data: files, error: filesError } = await supabaseAdmin
      .from('idea_project_files')
      .select('id, file_name, file_type, file_size, mime_type, created_at')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (filesError) {
      console.error('[IDEA FILES] Error fetching files:', filesError);
      return NextResponse.json(
        { error: '파일 목록을 가져올 수 없습니다.', details: filesError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ files: files || [] });
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
 * POST /api/projects/[id]/idea/files
 * 아이디어 프로젝트 파일 업로드 및 임베딩
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

    // FormData 파싱
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: '파일이 필요합니다.' },
        { status: 400 }
      );
    }

    // 파일 타입 검증 (.md, .txt만 허용)
    const allowedTypes = ['text/markdown', 'text/plain', 'text/md'];
    const allowedExtensions = ['.md', '.txt'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      return NextResponse.json(
        { error: '지원하지 않는 파일 형식입니다. .md 또는 .txt 파일만 업로드 가능합니다.' },
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

    // 파일 내용 읽기
    const fileContent = await file.text();

    // Storage 버킷 확인 및 생성
    const bucketExists = await ensureIdeaFilesBucketExists();
    if (!bucketExists) {
      return NextResponse.json(
        { error: 'Storage 버킷을 준비할 수 없습니다.' },
        { status: 500 }
      );
    }

    // 파일 메타데이터 저장
    const fileId = crypto.randomUUID();
    const storagePath = `${projectId}/${fileId}/${file.name}`;

    // Storage에 파일 업로드
    const fileBuffer = Buffer.from(fileContent, 'utf-8');
    const uploadedPath = await uploadIdeaFile(projectId, fileId, file.name, fileBuffer, file.type);

    if (!uploadedPath) {
      return NextResponse.json(
        { error: '파일 업로드에 실패했습니다.' },
        { status: 500 }
      );
    }

    // idea_project_files에 메타데이터 저장
    const { data: ideaFile, error: fileInsertError } = await supabaseAdmin
      .from('idea_project_files')
      .insert({
        id: fileId,
        project_id: projectId,
        owner_id: user.id,
        file_name: file.name,
        file_type: fileExtension,
        storage_path: uploadedPath,
        file_size: file.size,
        mime_type: file.type || 'text/plain',
      })
      .select()
      .single();

    if (fileInsertError || !ideaFile) {
      console.error('[IDEA FILES] Error saving file metadata:', fileInsertError);
      return NextResponse.json(
        { error: '파일 메타데이터 저장에 실패했습니다.', details: fileInsertError?.message },
        { status: 500 }
      );
    }

    // 비동기로 청킹 및 임베딩 처리 (백그라운드)
    // 즉시 응답 반환하고 백그라운드에서 처리
    processFileAsync(projectId, fileId, fileContent, file.name).catch((error) => {
      console.error('[IDEA FILES] Error processing file async:', error);
    });

    return NextResponse.json({
      success: true,
      file: {
        id: ideaFile.id,
        file_name: ideaFile.file_name,
        file_type: ideaFile.file_type,
        file_size: ideaFile.file_size,
        created_at: ideaFile.created_at,
      },
      message: '파일이 업로드되었습니다. 임베딩은 백그라운드에서 처리됩니다.',
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

/**
 * 파일 청킹 및 임베딩 처리 (비동기)
 */
async function processFileAsync(
  projectId: string,
  fileId: string,
  content: string,
  fileName: string
) {
  try {
    console.log(`[IDEA FILES] Processing file async: ${fileName}`);

    // 청킹
    const chunks = chunkText(content, fileName);

    if (chunks.length === 0) {
      console.warn(`[IDEA FILES] No chunks created for file: ${fileName}`);
      return;
    }

    // 임베딩
    const embeddings = await embedChunks(chunks);

    // idea_project_chunks에 저장
    const chunksToInsert = chunks.map((chunk, index) => ({
      project_id: projectId,
      file_id: fileId,
      content: chunk.content,
      embedding: embeddings[index],
      embedding_version: 'text-embedding-3-small',
      chunk_index: index,
    }));

    // 벡터 타입 변환을 위해 RPC 함수 사용
    const chunksJson = chunksToInsert.map((chunk) => ({
      project_id: chunk.project_id,
      file_id: chunk.file_id,
      content: chunk.content,
      embedding: chunk.embedding, // float8[] 배열
      embedding_version: chunk.embedding_version,
      chunk_index: chunk.chunk_index,
    }));

    const { error: chunksError } = await supabaseAdmin.rpc(
      'insert_idea_project_chunks',
      {
        p_chunks: chunksJson,
      }
    );

    if (chunksError) {
      console.error(`[IDEA FILES] Error inserting chunks:`, chunksError);
      throw chunksError;
    }

    console.log(`[IDEA FILES] Successfully processed file: ${fileName} (${chunks.length} chunks)`);
  } catch (error) {
    console.error(`[IDEA FILES] Error processing file async:`, error);
  }
}

