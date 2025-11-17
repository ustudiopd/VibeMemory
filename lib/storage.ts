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
 * 스크린샷 버킷 캐시 초기화 (디버깅용)
 */
export function resetScreenshotBucketCache() {
  screenshotBucketChecked = false;
  screenshotBucketExists = false;
  console.log('[STORAGE] Screenshot bucket cache reset');
}

/**
 * 스크린샷 버킷이 존재하는지 확인하고 없으면 생성
 * 캐시를 사용하되, 버킷이 없을 때는 항상 다시 확인합니다.
 */
async function ensureScreenshotBucketExists(): Promise<boolean> {
  // 캐시가 있고 버킷이 존재한다고 확인된 경우에만 캐시 사용
  if (screenshotBucketChecked && screenshotBucketExists) {
    return true;
  }

  try {
    console.log(`[STORAGE] Checking if bucket exists: ${SCREENSHOT_BUCKET_NAME}`);
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    
    if (listError) {
      console.error('[STORAGE] Error listing buckets:', listError);
      console.error('[STORAGE] Error details:', JSON.stringify(listError, null, 2));
      console.error('[STORAGE] Error message:', listError.message);
      // 에러가 발생해도 캐시하지 않고 다음에 다시 시도
      return false;
    }
    
    console.log(`[STORAGE] Total buckets found: ${buckets?.length || 0}`);
    if (buckets && buckets.length > 0) {
      console.log(`[STORAGE] Bucket names:`, buckets.map(b => b.name).join(', '));
      console.log(`[STORAGE] Looking for bucket: "${SCREENSHOT_BUCKET_NAME}"`);
      buckets.forEach(bucket => {
        console.log(`[STORAGE] - Comparing: "${bucket.name}" === "${SCREENSHOT_BUCKET_NAME}" ? ${bucket.name === SCREENSHOT_BUCKET_NAME}`);
      });
    } else {
      console.log(`[STORAGE] No buckets found in list`);
    }
    
    screenshotBucketExists = buckets?.some(bucket => bucket.name === SCREENSHOT_BUCKET_NAME) ?? false;
    console.log(`[STORAGE] Bucket ${SCREENSHOT_BUCKET_NAME} exists: ${screenshotBucketExists}`);
    
    // 버킷이 존재하는데도 찾지 못한 경우, 직접 확인
    if (!screenshotBucketExists && buckets && buckets.length > 0) {
      const foundBucket = buckets.find(b => b.name === SCREENSHOT_BUCKET_NAME || b.id === SCREENSHOT_BUCKET_NAME);
      if (foundBucket) {
        console.log(`[STORAGE] Found bucket by id or name:`, foundBucket);
        screenshotBucketExists = true;
      }
    }
    
    if (screenshotBucketExists) {
      // 버킷이 존재하면 캐시하고 true 반환
      screenshotBucketChecked = true;
      return true;
    }
    
    // 버킷이 없으면 생성 시도
    console.log(`[STORAGE] Bucket not found, attempting to create: ${SCREENSHOT_BUCKET_NAME}`);
    const { data: createData, error: createError } = await supabaseAdmin.storage.createBucket(SCREENSHOT_BUCKET_NAME, {
      public: false, // 비공개 버킷
      fileSizeLimit: 10485760, // 10MB 제한
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    });
    
    if (createError) {
      console.error(`[STORAGE] Error creating bucket:`, createError);
      console.error(`[STORAGE] Error details:`, JSON.stringify(createError, null, 2));
      console.error(`[STORAGE] Error message:`, createError.message);
      
      // 버킷이 이미 존재하는 경우 (다른 프로세스에서 생성했을 수 있음)
      if (createError.message?.includes('already exists')) {
        console.log(`[STORAGE] Bucket already exists (from another process), marking as exists`);
        screenshotBucketExists = true;
        screenshotBucketChecked = true;
        return true;
      }
      
      // 생성 실패 시에도 캐시하지 않음 (다음에 다시 시도 가능)
      return false;
    }
    
    console.log(`[STORAGE] Bucket created successfully: ${SCREENSHOT_BUCKET_NAME}`, createData);
    screenshotBucketExists = true;
    screenshotBucketChecked = true;
    return true;
  } catch (error) {
    console.error('[STORAGE] Exception ensuring screenshot bucket exists:', error);
    console.error('[STORAGE] Exception details:', error instanceof Error ? error.stack : String(error));
    // 예외 발생 시에도 캐시하지 않음
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
/**
 * 파일명을 안전한 형식으로 변환
 * Supabase Storage는 경로에 특수문자나 한글을 허용하지 않으므로
 * 파일명을 UUID + 확장자 형식으로 변환하거나, 안전한 문자만 사용
 */
function sanitizeFilename(filename: string): string {
  // 파일 확장자 추출
  const lastDotIndex = filename.lastIndexOf('.');
  const ext = lastDotIndex > 0 ? filename.substring(lastDotIndex).toLowerCase() : '';
  
  // Supabase Storage는 경로에 한글을 지원하지 않을 수 있으므로
  // 영문, 숫자, 하이픈, 언더스코어만 사용하는 안전한 파일명 생성
  // 타임스탬프 + 랜덤 문자열 + 확장자 형식 사용
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  
  // 확장자가 있으면 유지, 없으면 기본값
  const safeExt = ext || '.txt';
  
  // 원본 파일명에서 영문/숫자만 추출하여 prefix로 사용 (최대 20자)
  const nameWithoutExt = lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
  const alphanumericOnly = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
  const prefix = alphanumericOnly ? `${alphanumericOnly}_` : '';
  
  // 최종 파일명: prefix + timestamp + random + extension
  const finalName = `${prefix}${timestamp}_${random}${safeExt}`;
  
  return finalName;
}

export async function uploadScreenshot(
  projectId: string,
  screenshotId: string,
  filename: string,
  fileBuffer: Buffer | ArrayBuffer | Uint8Array,
  mimeType: string
): Promise<string | null> {
  try {
    console.log(`[STORAGE] Starting screenshot upload:`, {
      projectId,
      screenshotId,
      filename,
      mimeType,
      bufferSize: fileBuffer instanceof Buffer ? fileBuffer.length : fileBuffer.byteLength,
    });

    const bucketExists = await ensureScreenshotBucketExists();
    if (!bucketExists) {
      console.error(`[STORAGE] Bucket ${SCREENSHOT_BUCKET_NAME} does not exist and could not be created`);
      console.error(`[STORAGE] Please create the bucket manually in Supabase Dashboard:`);
      console.error(`[STORAGE] 1. Go to Storage > Buckets`);
      console.error(`[STORAGE] 2. Click "New bucket"`);
      console.error(`[STORAGE] 3. Name: ${SCREENSHOT_BUCKET_NAME}`);
      console.error(`[STORAGE] 4. Public: false`);
      console.error(`[STORAGE] 5. File size limit: 10MB`);
      console.error(`[STORAGE] 6. Allowed MIME types: image/png, image/jpeg, image/webp, image/gif`);
      return null;
    }
    
    // 파일명을 안전한 형식으로 변환 (한글 및 특수문자 제거)
    const safeFilename = sanitizeFilename(filename);
    console.log(`[STORAGE] Original filename: ${filename}`);
    console.log(`[STORAGE] Safe filename: ${safeFilename}`);
    
    // Storage 경로 생성: {project_id}/{screenshot_id}/{safe_filename}
    // 경로의 각 세그먼트는 UUID이므로 안전함
    const storagePath = `${projectId}/${screenshotId}/${safeFilename}`;
    console.log(`[STORAGE] Uploading to path: ${storagePath}`);
    console.log(`[STORAGE] Bucket name: ${SCREENSHOT_BUCKET_NAME}`);
    
    // 파일 업로드
    const { data, error } = await supabaseAdmin.storage
      .from(SCREENSHOT_BUCKET_NAME)
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      console.error(`[STORAGE] Error uploading screenshot ${storagePath}:`, error);
      console.error(`[STORAGE] Error details:`, JSON.stringify(error, null, 2));
      console.error(`[STORAGE] Error message:`, error.message);
      
      // 버킷이 없다는 에러인 경우 캐시 초기화
      if (error.message?.includes('Bucket not found') || error.message?.includes('does not exist')) {
        console.log(`[STORAGE] Bucket not found error, resetting cache`);
        screenshotBucketChecked = false;
        screenshotBucketExists = false;
      }
      
      return null;
    }

    console.log(`[STORAGE] Successfully uploaded screenshot to ${storagePath}`);
    return storagePath;
  } catch (error) {
    console.error(`[STORAGE] Exception uploading screenshot:`, error);
    console.error(`[STORAGE] Exception details:`, error instanceof Error ? error.stack : String(error));
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
      console.error('[STORAGE] List error details:', JSON.stringify(listError, null, 2));
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
        allowedMimeTypes: ['text/markdown', 'text/plain', 'text/x-markdown', 'application/x-markdown'],
      });
      
      if (createError) {
        // 이미 존재하는 경우 성공으로 처리 (동시성 문제 해결)
        if (createError.message?.includes('already exists') || (createError as any)?.statusCode === 409) {
          console.log(`[STORAGE] Bucket already exists, marking as exists`);
          ideaFilesBucketExists = true;
          ideaFilesBucketChecked = true;
          return true;
        }
        
        console.error(`[STORAGE] Error creating bucket:`, createError);
        console.error(`[STORAGE] Create error details:`, JSON.stringify(createError, null, 2));
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
    console.log(`[STORAGE] Starting idea file upload:`, {
      projectId,
      fileId,
      filename,
      mimeType,
      bufferSize: fileBuffer instanceof Buffer ? fileBuffer.length : fileBuffer.byteLength,
    });

    const bucketExists = await ensureIdeaFilesBucketExists();
    if (!bucketExists) {
      console.error(`[STORAGE] Bucket ${IDEA_FILES_BUCKET_NAME} does not exist and could not be created`);
      console.error(`[STORAGE] Please create the bucket manually in Supabase Dashboard:`);
      console.error(`[STORAGE] 1. Go to Storage > Buckets`);
      console.error(`[STORAGE] 2. Click "New bucket"`);
      console.error(`[STORAGE] 3. Name: ${IDEA_FILES_BUCKET_NAME}`);
      console.error(`[STORAGE] 4. Public: false`);
      console.error(`[STORAGE] 5. File size limit: 10MB`);
      console.error(`[STORAGE] 6. Allowed MIME types: text/markdown, text/plain`);
      return null;
    }
    
    // 파일명을 안전한 형식으로 변환 (한글 및 특수문자 처리)
    const safeFilename = sanitizeFilename(filename);
    console.log(`[STORAGE] Original filename: ${filename}`);
    console.log(`[STORAGE] Safe filename: ${safeFilename}`);
    console.log(`[STORAGE] File size: ${fileBuffer instanceof Buffer ? fileBuffer.length : fileBuffer.byteLength} bytes`);
    console.log(`[STORAGE] MIME type: ${mimeType}`);
    
    // Storage 경로 생성: {project_id}/{file_id}/{safe_filename}
    const storagePath = `${projectId}/${fileId}/${safeFilename}`;
    console.log(`[STORAGE] Uploading to path: ${storagePath}`);
    console.log(`[STORAGE] Bucket name: ${IDEA_FILES_BUCKET_NAME}`);
    console.log(`[STORAGE] Full storage path length: ${storagePath.length} characters`);
    
    // 파일 업로드
    let uploadResult = await supabaseAdmin.storage
      .from(IDEA_FILES_BUCKET_NAME)
      .upload(storagePath, fileBuffer, {
        contentType: mimeType || 'text/plain',
        upsert: true,
        cacheControl: '3600',
      });

    let { data, error } = uploadResult;

    // Bucket not found 에러인 경우 버킷 재확인 후 재시도
    if (error && (error.message?.includes('Bucket not found') || error.message?.includes('does not exist') || (error as any).statusCode === 404)) {
      console.log(`[STORAGE] Bucket not found error, resetting cache and retrying...`);
      ideaFilesBucketChecked = false;
      ideaFilesBucketExists = false;
      
      const retryBucketExists = await ensureIdeaFilesBucketExists();
      if (retryBucketExists) {
        console.log(`[STORAGE] Retrying upload after bucket verification...`);
        uploadResult = await supabaseAdmin.storage
          .from(IDEA_FILES_BUCKET_NAME)
          .upload(storagePath, fileBuffer, {
            contentType: mimeType || 'text/plain',
            upsert: true,
            cacheControl: '3600',
          });
        ({ data, error } = uploadResult);
      }
    }

    if (error) {
      // 에러 객체의 모든 속성 추출
      const errorDetails: any = {
        message: error.message,
        name: (error as any).name,
        statusCode: (error as any).statusCode,
        statusText: (error as any).statusText,
        error: (error as any).error,
        stack: error instanceof Error ? error.stack : undefined,
      };
      
      // 에러 객체의 모든 열거 가능한 속성 추가
      try {
        Object.keys(error).forEach(key => {
          if (!errorDetails[key]) {
            errorDetails[key] = (error as any)[key];
          }
        });
      } catch (e) {
        // 무시
      }
      
      console.error(`[STORAGE] Error uploading idea file ${storagePath}:`, error);
      console.error(`[STORAGE] Error details (JSON):`, JSON.stringify(errorDetails, null, 2));
      console.error(`[STORAGE] Error message:`, error.message);
      console.error(`[STORAGE] Error statusCode:`, (error as any).statusCode);
      console.error(`[STORAGE] Error name:`, (error as any).name);
      console.error(`[STORAGE] Error statusText:`, (error as any).statusText);
      console.error(`[STORAGE] Full error object:`, error);
      console.error(`[STORAGE] File info - size: ${fileBuffer instanceof Buffer ? fileBuffer.length : fileBuffer.byteLength}, mimeType: ${mimeType}`);
      console.error(`[STORAGE] Storage path: ${storagePath}`);
      console.error(`[STORAGE] Bucket name: ${IDEA_FILES_BUCKET_NAME}`);
      console.error(`[STORAGE] Safe filename: ${safeFilename}`);
      console.error(`[STORAGE] Original filename: ${filename}`);
      
      return null;
    }

    console.log(`[STORAGE] Successfully uploaded idea file to ${storagePath}`, data);
    return storagePath;
  } catch (error) {
    console.error(`[STORAGE] Exception uploading idea file:`, error);
    console.error(`[STORAGE] Exception details:`, error instanceof Error ? error.stack : String(error));
    return null;
  }
}

