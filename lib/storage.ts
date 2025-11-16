import { supabaseAdmin } from './supabase';

const BUCKET_NAME = 'repo-files';

// 버킷 확인 결과 캐싱 (한 번만 확인)
let bucketChecked = false;
let bucketExists = false;

/**
 * Storage 버킷이 존재하는지 확인하고 없으면 생성
 * 최적화: 한 번만 확인하고 결과를 캐싱합니다.
 */
async function ensureBucketExists(): Promise<boolean> {
  // 이미 확인했다면 캐시된 결과 반환
  if (bucketChecked) {
    return bucketExists;
  }

  try {
    // 버킷 목록 확인
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    
    if (listError) {
      console.error('[STORAGE] Error listing buckets:', listError);
      bucketChecked = true;
      bucketExists = false;
      return false;
    }
    
    bucketExists = buckets?.some(bucket => bucket.name === BUCKET_NAME) ?? false;
    
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
        bucketChecked = true;
        bucketExists = false;
        return false;
      }
      
      console.log(`[STORAGE] Bucket created: ${BUCKET_NAME}`);
      bucketExists = true;
    }
    
    bucketChecked = true;
    return bucketExists;
  } catch (error) {
    console.error('[STORAGE] Exception ensuring bucket exists:', error);
    bucketChecked = true;
    bucketExists = false;
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

// ========== 스크린샷 관련 함수 ==========

const SCREENSHOT_BUCKET_NAME = 'project-screenshots';

// 스크린샷 버킷 확인 결과 캐싱
let screenshotBucketChecked = false;
let screenshotBucketExists = false;

/**
 * 스크린샷 버킷이 존재하는지 확인하고 없으면 생성
 */
async function ensureScreenshotBucketExists(): Promise<boolean> {
  if (screenshotBucketChecked) {
    return screenshotBucketExists;
  }

  try {
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    
    if (listError) {
      console.error('[STORAGE] Error listing buckets:', listError);
      screenshotBucketChecked = true;
      screenshotBucketExists = false;
      return false;
    }
    
    screenshotBucketExists = buckets?.some(bucket => bucket.name === SCREENSHOT_BUCKET_NAME) ?? false;
    
    if (!screenshotBucketExists) {
      console.log(`[STORAGE] Creating bucket: ${SCREENSHOT_BUCKET_NAME}`);
      const { data, error: createError } = await supabaseAdmin.storage.createBucket(SCREENSHOT_BUCKET_NAME, {
        public: false, // 비공개 버킷
        fileSizeLimit: 10485760, // 10MB 제한
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      });
      
      if (createError) {
        console.error(`[STORAGE] Error creating bucket:`, createError);
        screenshotBucketChecked = true;
        screenshotBucketExists = false;
        return false;
      }
      
      console.log(`[STORAGE] Bucket created: ${SCREENSHOT_BUCKET_NAME}`);
      screenshotBucketExists = true;
    }
    
    screenshotBucketChecked = true;
    return screenshotBucketExists;
  } catch (error) {
    console.error('[STORAGE] Exception ensuring screenshot bucket exists:', error);
    screenshotBucketChecked = true;
    screenshotBucketExists = false;
    return false;
  }
}

/**
 * 스크린샷 이미지를 Storage에 업로드
 * @param projectId 프로젝트 ID
 * @param screenshotId 스크린샷 ID
 * @param filename 파일명
 * @param fileBuffer 파일 버퍼
 * @param mimeType MIME 타입
 * @returns Storage 경로 또는 null
 */
export async function uploadScreenshot(
  projectId: string,
  screenshotId: string,
  filename: string,
  fileBuffer: Buffer | ArrayBuffer | Uint8Array,
  mimeType: string
): Promise<string | null> {
  try {
    const bucketExists = await ensureScreenshotBucketExists();
    if (!bucketExists) {
      console.warn(`[STORAGE] Bucket ${SCREENSHOT_BUCKET_NAME} does not exist and could not be created`);
      return null;
    }
    
    // Storage 경로 생성: {project_id}/{screenshot_id}/{filename}
    const storagePath = `${projectId}/${screenshotId}/${filename}`;
    
    // 파일 업로드
    const { data, error } = await supabaseAdmin.storage
      .from(SCREENSHOT_BUCKET_NAME)
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      console.error(`[STORAGE] Error uploading screenshot ${storagePath}:`, error);
      return null;
    }

    console.log(`[STORAGE] Uploaded screenshot to ${storagePath}`);
    return storagePath;
  } catch (error) {
    console.error(`[STORAGE] Exception uploading screenshot:`, error);
    return null;
  }
}

/**
 * 스크린샷 이미지 URL 가져오기
 * @param storagePath Storage 경로
 * @returns Public URL 또는 null
 */
export function getScreenshotUrl(storagePath: string): string | null {
  try {
    const { data } = supabaseAdmin.storage
      .from(SCREENSHOT_BUCKET_NAME)
      .getPublicUrl(storagePath);
    
    return data.publicUrl;
  } catch (error) {
    console.error(`[STORAGE] Exception getting screenshot URL:`, error);
    return null;
  }
}

/**
 * 스크린샷 이미지 삭제
 * @param storagePath Storage 경로
 * @returns 성공 여부
 */
export async function deleteScreenshot(storagePath: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.storage
      .from(SCREENSHOT_BUCKET_NAME)
      .remove([storagePath]);

    if (error) {
      console.error(`[STORAGE] Error deleting screenshot ${storagePath}:`, error);
      return false;
    }

    console.log(`[STORAGE] Deleted screenshot ${storagePath}`);
    return true;
  } catch (error) {
    console.error(`[STORAGE] Exception deleting screenshot:`, error);
    return false;
  }
}

// ========== 아이디어 프로젝트 파일 관련 함수 ==========

const IDEA_FILES_BUCKET_NAME = 'idea-project-files';

// 아이디어 파일 버킷 확인 결과 캐싱
let ideaFilesBucketChecked = false;
let ideaFilesBucketExists = false;

/**
 * 아이디어 파일 버킷이 존재하는지 확인하고 없으면 생성
 */
export async function ensureIdeaFilesBucketExists(): Promise<boolean> {
  if (ideaFilesBucketChecked) {
    return ideaFilesBucketExists;
  }

  try {
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    
    if (listError) {
      console.error('[STORAGE] Error listing buckets:', listError);
      ideaFilesBucketChecked = true;
      ideaFilesBucketExists = false;
      return false;
    }
    
    ideaFilesBucketExists = buckets?.some(bucket => bucket.name === IDEA_FILES_BUCKET_NAME) ?? false;
    
    if (!ideaFilesBucketExists) {
      console.log(`[STORAGE] Creating bucket: ${IDEA_FILES_BUCKET_NAME}`);
      const { data, error: createError } = await supabaseAdmin.storage.createBucket(IDEA_FILES_BUCKET_NAME, {
        public: false, // 비공개 버킷
        fileSizeLimit: 10485760, // 10MB 제한
        allowedMimeTypes: ['text/markdown', 'text/plain'],
      });
      
      if (createError) {
        console.error(`[STORAGE] Error creating bucket:`, createError);
        ideaFilesBucketChecked = true;
        ideaFilesBucketExists = false;
        return false;
      }
      
      console.log(`[STORAGE] Bucket created: ${IDEA_FILES_BUCKET_NAME}`);
      ideaFilesBucketExists = true;
    }
    
    ideaFilesBucketChecked = true;
    return ideaFilesBucketExists;
  } catch (error) {
    console.error('[STORAGE] Exception ensuring idea files bucket exists:', error);
    ideaFilesBucketChecked = true;
    ideaFilesBucketExists = false;
    return false;
  }
}

/**
 * 아이디어 프로젝트 파일을 Storage에 업로드
 * @param projectId 프로젝트 ID
 * @param fileId 파일 ID
 * @param filename 파일명
 * @param fileBuffer 파일 버퍼
 * @param mimeType MIME 타입
 * @returns Storage 경로 또는 null
 */
export async function uploadIdeaFile(
  projectId: string,
  fileId: string,
  filename: string,
  fileBuffer: Buffer | ArrayBuffer | Uint8Array,
  mimeType: string
): Promise<string | null> {
  try {
    const bucketExists = await ensureIdeaFilesBucketExists();
    if (!bucketExists) {
      console.warn(`[STORAGE] Bucket ${IDEA_FILES_BUCKET_NAME} does not exist and could not be created`);
      return null;
    }
    
    // Storage 경로 생성: {project_id}/{file_id}/{filename}
    const storagePath = `${projectId}/${fileId}/${filename}`;
    
    // 파일 업로드
    const { data, error } = await supabaseAdmin.storage
      .from(IDEA_FILES_BUCKET_NAME)
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      console.error(`[STORAGE] Error uploading idea file ${storagePath}:`, error);
      return null;
    }

    console.log(`[STORAGE] Uploaded idea file to ${storagePath}`);
    return storagePath;
  } catch (error) {
    console.error(`[STORAGE] Exception uploading idea file:`, error);
    return null;
  }
}

