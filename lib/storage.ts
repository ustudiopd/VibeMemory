import { supabaseAdmin } from './supabase';

const BUCKET_NAME = 'repo-files';

/**
 * Storage 버킷이 존재하는지 확인하고 없으면 생성
 */
async function ensureBucketExists(): Promise<boolean> {
  try {
    // 버킷 목록 확인
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    
    if (listError) {
      console.error('[STORAGE] Error listing buckets:', listError);
      return false;
    }
    
    const bucketExists = buckets?.some(bucket => bucket.name === BUCKET_NAME);
    
    if (!bucketExists) {
      console.log(`[STORAGE] Creating bucket: ${BUCKET_NAME}`);
      // 버킷 생성 (공개 설정 - 필요에 따라 변경)
      const { data, error: createError } = await supabaseAdmin.storage.createBucket(BUCKET_NAME, {
        public: false, // 비공개 버킷
        fileSizeLimit: 10485760, // 10MB 제한
        allowedMimeTypes: ['text/markdown', 'text/plain'],
      });
      
      if (createError) {
        console.error(`[STORAGE] Error creating bucket:`, createError);
        return false;
      }
      
      console.log(`[STORAGE] Bucket created: ${BUCKET_NAME}`);
    }
    
    return true;
  } catch (error) {
    console.error('[STORAGE] Exception ensuring bucket exists:', error);
    return false;
  }
}

/**
 * 파일을 Supabase Storage에 업로드
 * 경로 형식: {project_id}/{sha}/{filename}
 */
export async function uploadFileToStorage(
  projectId: string,
  sha: string,
  filePath: string,
  content: string
): Promise<string | null> {
  try {
    // 버킷 존재 확인
    const bucketExists = await ensureBucketExists();
    if (!bucketExists) {
      console.warn(`[STORAGE] Bucket ${BUCKET_NAME} does not exist and could not be created`);
      return null;
    }
    
    // 파일명 추출 (경로의 마지막 부분)
    const filename = filePath.split('/').pop() || filePath;
    
    // Storage 경로 생성: {project_id}/{sha}/{filename}
    const storagePath = `${projectId}/${sha}/${filename}`;
    
    // 파일 업로드
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(storagePath, content, {
        contentType: 'text/markdown',
        upsert: true, // 이미 있으면 덮어쓰기
      });

    if (error) {
      console.error(`[STORAGE] Error uploading file ${storagePath}:`, error);
      return null;
    }

    console.log(`[STORAGE] Uploaded file to ${storagePath}`);
    return storagePath;
  } catch (error) {
    console.error(`[STORAGE] Exception uploading file:`, error);
    return null;
  }
}

/**
 * Supabase Storage에서 파일 다운로드
 */
export async function downloadFileFromStorage(
  storagePath: string
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .download(storagePath);

    if (error) {
      console.error(`[STORAGE] Error downloading file ${storagePath}:`, error);
      return null;
    }

    const content = await data.text();
    return content;
  } catch (error) {
    console.error(`[STORAGE] Exception downloading file:`, error);
    return null;
  }
}

/**
 * Storage에서 파일 삭제
 */
export async function deleteFileFromStorage(
  storagePath: string
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .remove([storagePath]);

    if (error) {
      console.error(`[STORAGE] Error deleting file ${storagePath}:`, error);
      return false;
    }

    console.log(`[STORAGE] Deleted file ${storagePath}`);
    return true;
  } catch (error) {
    console.error(`[STORAGE] Exception deleting file:`, error);
    return false;
  }
}

/**
 * Storage 경로 생성 헬퍼
 */
export function getStoragePath(projectId: string, sha: string, filePath: string): string {
  const filename = filePath.split('/').pop() || filePath;
  return `${projectId}/${sha}/${filename}`;
}

