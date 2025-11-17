import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { chunkText, embedChunks } from '@/lib/rag';
import { ensureIdeaFilesBucketExists, uploadIdeaFile } from '@/lib/storage';

const IDEA_FILES_BUCKET = 'idea-project-files';

/**
 * 파일 확장자 기반으로 MIME 타입을 정규화
 * 브라우저가 감지한 MIME 타입이 다를 수 있으므로 확장자 기반으로 강제 설정
 * 주의: Supabase Storage는 charset 파라미터를 지원하지 않으므로 MIME 타입만 반환
 */
function normalizeMimeType(filename: string, fallback?: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  
  // fallback에서도 charset 제거
  if (fallback) {
    const withoutCharset = fallback.split(';')[0].trim();
    return withoutCharset;
  }
  
  return 'text/plain';
}

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
export const runtime = 'nodejs'; // Buffer 처리 안정성을 위해 Node.js 런타임 명시

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
    const allowedTypes = ['text/markdown', 'text/plain', 'text/md', ''];
    const allowedExtensions = ['.md', '.txt'];
    const lastDotIndex = file.name.lastIndexOf('.');
    const fileExtension = lastDotIndex >= 0 
      ? file.name.substring(lastDotIndex).toLowerCase() 
      : '';
    
    console.log('[IDEA FILES] File validation:', {
      fileName: file.name,
      fileType: file.type,
      fileExtension,
      fileSize: file.size,
      hasValidType: allowedTypes.includes(file.type),
      hasValidExtension: allowedExtensions.includes(fileExtension)
    });
    
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      console.error('[IDEA FILES] File type validation failed:', {
        fileName: file.name,
        fileType: file.type,
        fileExtension
      });
      return NextResponse.json(
        { 
          error: '지원하지 않는 파일 형식입니다. .md 또는 .txt 파일만 업로드 가능합니다.',
          details: `파일명: ${file.name}, MIME 타입: ${file.type || '(없음)'}, 확장자: ${fileExtension || '(없음)'}`
        },
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
    console.log('[IDEA FILES] Reading file content...');
    console.log('[IDEA FILES] File size before reading:', file.size, 'bytes');
    const fileContent = await file.text();
    console.log('[IDEA FILES] File content length:', fileContent.length, 'characters');

    // Storage 버킷 확인 및 생성
    console.log('[IDEA FILES] Checking bucket existence...');
    const bucketExists = await ensureIdeaFilesBucketExists();
    if (!bucketExists) {
      console.error('[IDEA FILES] Bucket check failed');
      return NextResponse.json(
        { error: 'Storage 버킷을 준비할 수 없습니다. 관리자에게 문의하세요.' },
        { status: 500 }
      );
    }
    console.log('[IDEA FILES] Bucket exists:', bucketExists);

    // 파일 메타데이터 저장
    const fileId = crypto.randomUUID();
    console.log('[IDEA FILES] Generated file ID:', fileId);

    // Storage에 파일 업로드 (uploadIdeaFile 내부에서 sanitizeFilename 사용)
    console.log('[IDEA FILES] Uploading file to storage...');
    const fileBuffer = Buffer.from(fileContent, 'utf-8');
    
    // MIME 타입 정규화 (확장자 기반으로 강제 설정)
    const normalizedMimeType = normalizeMimeType(file.name, file.type);
    console.log('[IDEA FILES] MIME type normalization:', {
      original: file.type,
      normalized: normalizedMimeType,
      fileName: file.name
    });
    
    const uploadedPath = await uploadIdeaFile(projectId, fileId, file.name, fileBuffer, normalizedMimeType);

    if (!uploadedPath) {
      console.error('[IDEA FILES] File upload failed. File ID:', fileId);
      console.error('[IDEA FILES] File details:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        bufferSize: fileBuffer.byteLength
      });
      
      // 버킷 상태 재확인
      const { data: finalBuckets } = await supabaseAdmin.storage.listBuckets();
      const finalBucketExists = finalBuckets?.some(b => b.name === 'idea-project-files') ?? false;
      
      // 서버 로그에서 실제 에러를 확인할 수 있도록 안내
      return NextResponse.json(
        { 
          error: '파일 업로드에 실패했습니다.',
          details: finalBucketExists 
            ? `버킷은 존재하지만 업로드에 실패했습니다. 파일명: "${file.name}", 크기: ${file.size} bytes, MIME 타입: ${file.type || '(없음)'}. 서버 터미널의 [STORAGE] 로그에서 실제 에러 메시지를 확인하세요.`
            : `Storage 버킷('idea-project-files')이 존재하지 않습니다. Supabase Dashboard에서 버킷을 생성해주세요: Storage > Buckets > New bucket`,
          bucketExists: finalBucketExists,
          availableBuckets: finalBuckets?.map(b => b.name) || [],
          hint: '서버 터미널의 [STORAGE] 로그를 확인하여 상세 에러 정보를 확인하세요. 특히 "Error uploading idea file" 로그를 찾아보세요.',
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
        },
        { status: 500 }
      );
    }
    console.log('[IDEA FILES] File uploaded successfully:', uploadedPath);

    // idea_project_files에 메타데이터 저장
    console.log('[IDEA FILES] Saving file metadata to database...');
    const insertData = {
      id: fileId,
      project_id: projectId,
      owner_id: user.id,
      file_name: file.name,
      file_type: fileExtension,
      storage_path: uploadedPath,
      file_size: file.size,
      mime_type: file.type || 'text/plain',
    };
    console.log('[IDEA FILES] Insert data:', JSON.stringify(insertData, null, 2));
    
    const { data: ideaFile, error: fileInsertError } = await supabaseAdmin
      .from('idea_project_files')
      .insert(insertData)
      .select()
      .single();

    if (fileInsertError || !ideaFile) {
      console.error('[IDEA FILES] Error saving file metadata:', fileInsertError);
      console.error('[IDEA FILES] Error details:', JSON.stringify(fileInsertError, null, 2));
      console.error('[IDEA FILES] Insert data was:', JSON.stringify(insertData, null, 2));
      
      // Storage에 업로드된 파일이 있다면 롤백 시도
      if (uploadedPath) {
        console.warn('[IDEA FILES] Attempting to rollback uploaded file:', uploadedPath);
        // 롤백은 비동기로 처리 (실패해도 무시)
        supabaseAdmin.storage
          .from('idea-project-files')
          .remove([uploadedPath])
          .catch((rollbackError) => {
            console.error('[IDEA FILES] Rollback failed:', rollbackError);
          });
      }
      
      return NextResponse.json(
        { 
          error: '파일 메타데이터 저장에 실패했습니다.', 
          details: fileInsertError?.message || '데이터베이스 저장 중 오류가 발생했습니다.',
          code: fileInsertError?.code,
          hint: fileInsertError?.hint
        },
        { status: 500 }
      );
    }
    console.log('[IDEA FILES] File metadata saved successfully:', ideaFile.id);

    // 비동기로 청킹 및 임베딩 처리 (백그라운드)
    // 즉시 응답 반환하고 백그라운드에서 처리
    console.log('[IDEA FILES] Starting async processing for file:', file.name);
    processFileAsync(projectId, fileId, fileContent, file.name)
      .then(() => {
        console.log('[IDEA FILES] Async processing completed successfully for:', file.name);
      })
      .catch((error) => {
        console.error('[IDEA FILES] Error processing file async:', error);
        console.error('[IDEA FILES] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
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
    console.error('[IDEA FILES] Unexpected error:', error);
    console.error('[IDEA FILES] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('[IDEA FILES] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    
    return NextResponse.json(
      {
        error: '파일 업로드 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
        type: error instanceof Error ? error.constructor.name : typeof error,
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

    console.log(`[IDEA FILES] ✅ Successfully processed file: ${fileName}`);
    console.log(`[IDEA FILES] ✅ Created ${chunks.length} chunks with embeddings`);
    console.log(`[IDEA FILES] ✅ File is now ready for RAG search in chat`);
  } catch (error) {
    console.error(`[IDEA FILES] Error processing file async:`, error);
  }
}

