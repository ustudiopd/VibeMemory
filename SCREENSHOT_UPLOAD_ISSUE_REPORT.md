# 스크린샷 업로드 실패 원인 분석 보고서

## 📋 문제 개요

**증상**: 스크린샷 업로드 시 500 Internal Server Error 발생
**환경**: 로컬 개발 환경 및 Vercel 프로덕션 환경 모두에서 발생
**에러 메시지**: "스크린샷 업로드에 실패했습니다. (Storage 버킷('project-screenshots')이 존재하지 않습니다.)"

## 🔍 조사 결과

### 1. 버킷 존재 여부 확인

#### ✅ 버킷은 실제로 존재함
- **SQL 마이그레이션**: `migrations/create_storage_buckets.sql`을 통해 `storage.buckets` 테이블에 버킷 레코드 생성 완료
- **API 확인**: `/api/admin/create-buckets` 엔드포인트 호출 결과:
  ```json
  {
    "success": true,
    "results": [
      {"name": "project-screenshots", "status": "exists", "message": "이미 존재함"},
      {"name": "idea-project-files", "status": "exists", "message": "이미 존재함"},
      {"name": "repo-files", "status": "exists", "message": "이미 존재함"}
    ],
    "existingBuckets": ["repo-files", "project-screenshots", "idea-project-files"],
    "finalBuckets": ["repo-files", "project-screenshots", "idea-project-files"]
  }
  ```

### 2. 코드 흐름 분석

#### 문제 발생 지점
1. **`lib/storage.ts`의 `ensureScreenshotBucketExists()` 함수**
   - `supabaseAdmin.storage.listBuckets()` 호출
   - 버킷 목록에서 `project-screenshots` 찾기 시도
   - 버킷을 찾지 못하면 `false` 반환

2. **`lib/storage.ts`의 `uploadScreenshot()` 함수**
   - `ensureScreenshotBucketExists()`가 `false`를 반환하면 `null` 반환
   - 이로 인해 API 엔드포인트에서 500 에러 발생

3. **`app/api/projects/[id]/screenshots/route.ts`**
   - `uploadScreenshot()`가 `null`을 반환하면 에러 응답 반환

### 3. 가능한 원인 분석

#### 🔴 원인 1: Supabase Storage API와 SQL 직접 삽입 간의 불일치

**가설**: SQL로 `storage.buckets` 테이블에 직접 INSERT한 레코드가 Supabase Storage API의 `listBuckets()`에서 인식되지 않을 수 있음.

**근거**:
- Supabase Storage는 내부적으로 메타데이터나 인덱스를 별도로 관리할 수 있음
- Storage API는 단순히 `storage.buckets` 테이블을 읽는 것이 아니라, 내부 캐시나 다른 메타데이터를 참조할 수 있음
- SQL로 직접 삽입한 레코드가 Storage API의 내부 상태와 동기화되지 않았을 가능성

**검증 방법**:
```typescript
// Storage API를 통해 버킷 생성 시도
const { data, error } = await supabaseAdmin.storage.createBucket('project-screenshots', {
  public: false,
  fileSizeLimit: 10485760,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
});
```

#### 🔴 원인 2: 권한 문제

**가설**: `SUPABASE_SERVICE_ROLE_KEY`를 사용한 `supabaseAdmin` 클라이언트가 Storage 버킷 목록 조회 권한이 없을 수 있음.

**근거**:
- Service Role Key는 일반적으로 모든 권한을 가지지만, Storage API의 경우 특별한 권한 설정이 필요할 수 있음
- RLS (Row Level Security) 정책이 Storage 버킷 목록 조회에 영향을 줄 수 있음

**검증 방법**:
- Supabase Dashboard에서 Storage 버킷 목록이 보이는지 확인
- Service Role Key의 권한 확인

#### 🔴 원인 3: 버킷 이름 불일치

**가설**: 버킷 이름 비교 시 대소문자, 공백, 특수문자 등으로 인한 불일치.

**근거**:
- SQL로 삽입한 버킷 이름과 코드에서 찾는 이름이 정확히 일치하지 않을 수 있음
- `bucket.name === SCREENSHOT_BUCKET_NAME` 비교가 실패할 수 있음

**검증 방법**:
```typescript
// 버킷 이름을 정확히 비교
buckets.forEach(bucket => {
  console.log(`Comparing: "${bucket.name}" === "${SCREENSHOT_BUCKET_NAME}"`);
  console.log(`Match: ${bucket.name === SCREENSHOT_BUCKET_NAME}`);
  console.log(`Bucket id: ${bucket.id}, name: ${bucket.name}`);
});
```

#### 🔴 원인 4: 캐시 문제

**가설**: 모듈 레벨 캐시 변수가 서버 재시작 후에도 잘못된 값을 유지.

**근거**:
- `screenshotBucketChecked`와 `screenshotBucketExists`가 모듈 레벨 변수로 선언됨
- 서버가 재시작되어도 이전 요청에서 캐시된 값이 남아있을 수 있음
- 하지만 코드에서 캐시 초기화 로직을 추가했음에도 문제가 지속됨

#### 🔴 원인 5: Vercel 환경 변수 문제

**가설**: 프로덕션 환경에서 `SUPABASE_SERVICE_ROLE_KEY`가 제대로 설정되지 않았거나, 다른 Supabase 프로젝트를 가리키고 있을 수 있음.

**근거**:
- 로컬과 프로덕션에서 모두 같은 에러 발생
- Vercel 환경 변수 설정이 누락되었거나 잘못되었을 가능성

## 🛠️ 시도한 해결 방법

### 1. ✅ 버킷 생성 마이그레이션
- SQL 마이그레이션으로 `storage.buckets` 테이블에 버킷 레코드 생성
- 결과: 버킷은 생성되었지만 API에서 인식되지 않음

### 2. ✅ 로깅 강화
- 버킷 목록 조회 시 상세 로그 추가
- 버킷 이름 비교 로직에 디버깅 로그 추가
- 결과: 로그를 통해 정확한 원인 파악 필요

### 3. ✅ 캐시 로직 개선
- 버킷이 없을 때는 항상 다시 확인하도록 수정
- 에러 발생 시 캐시 초기화 로직 추가
- 결과: 문제 지속

### 4. ✅ 버킷 생성 API 엔드포인트 추가
- `/api/admin/create-buckets` 엔드포인트 생성
- Storage API를 통해 버킷 생성 시도
- 결과: 버킷이 이미 존재한다고 응답

## 💡 권장 해결 방안

### 방안 1: Storage API를 통한 버킷 생성 (우선 권장)

**작업**:
1. 기존 SQL로 생성한 버킷 레코드 삭제
2. Storage API의 `createBucket()` 메서드를 사용하여 버킷 생성
3. 버킷 생성이 실패하면 (이미 존재하는 경우) 에러를 무시하고 계속 진행

**코드 예시**:
```typescript
async function ensureScreenshotBucketExists(): Promise<boolean> {
  // 캐시 확인
  if (screenshotBucketChecked && screenshotBucketExists) {
    return true;
  }

  try {
    // 버킷 목록 확인
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    
    if (listError) {
      console.error('[STORAGE] Error listing buckets:', listError);
      return false;
    }
    
    // 버킷 존재 확인
    const exists = buckets?.some(b => b.name === SCREENSHOT_BUCKET_NAME) ?? false;
    
    if (exists) {
      screenshotBucketExists = true;
      screenshotBucketChecked = true;
      return true;
    }
    
    // 버킷 생성 시도
    const { error: createError } = await supabaseAdmin.storage.createBucket(SCREENSHOT_BUCKET_NAME, {
      public: false,
      fileSizeLimit: 10485760,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    });
    
    // 이미 존재하는 경우도 성공으로 처리
    if (!createError || createError.message?.includes('already exists') || createError.statusCode === 409) {
      screenshotBucketExists = true;
      screenshotBucketChecked = true;
      return true;
    }
    
    console.error('[STORAGE] Failed to create bucket:', createError);
    return false;
  } catch (error) {
    console.error('[STORAGE] Exception:', error);
    return false;
  }
}
```

### 방안 2: 버킷 존재 여부 확인 로직 개선

**작업**:
1. `listBuckets()`가 실패하거나 버킷을 찾지 못하는 경우, 직접 업로드를 시도
2. 업로드 시 "Bucket not found" 에러가 발생하면 그때 버킷 생성 시도
3. 재시도 로직 추가

**코드 예시**:
```typescript
export async function uploadScreenshot(...): Promise<string | null> {
  // 버킷 확인 생략하고 직접 업로드 시도
  const storagePath = `${projectId}/${screenshotId}/${filename}`;
  
  const { data, error } = await supabaseAdmin.storage
    .from(SCREENSHOT_BUCKET_NAME)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    // Bucket not found 에러인 경우 버킷 생성 시도
    if (error.message?.includes('Bucket not found') || error.statusCode === 404) {
      console.log('[STORAGE] Bucket not found, attempting to create...');
      const createResult = await ensureScreenshotBucketExists();
      
      if (createResult) {
        // 재시도
        const { data: retryData, error: retryError } = await supabaseAdmin.storage
          .from(SCREENSHOT_BUCKET_NAME)
          .upload(storagePath, fileBuffer, {
            contentType: mimeType,
            upsert: true,
          });
        
        if (!retryError) {
          return storagePath;
        }
      }
    }
    
    console.error('[STORAGE] Upload failed:', error);
    return null;
  }
  
  return storagePath;
}
```

### 방안 3: Supabase Dashboard에서 수동 생성

**작업**:
1. Supabase Dashboard → Storage → Buckets로 이동
2. "New bucket" 클릭
3. 다음 설정으로 버킷 생성:
   - Name: `project-screenshots`
   - Public: `false`
   - File size limit: `10MB`
   - Allowed MIME types: `image/png`, `image/jpeg`, `image/webp`, `image/gif`

**장점**: 가장 확실한 방법
**단점**: 수동 작업 필요, 자동화 불가

### 방안 4: 환경 변수 및 권한 확인

**작업**:
1. Vercel 환경 변수 확인:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. Service Role Key가 올바른 프로젝트의 키인지 확인
3. Supabase Dashboard에서 Service Role Key 권한 확인

## 📊 우선순위

1. **방안 1 (Storage API를 통한 버킷 생성)** - 가장 권장
2. **방안 2 (업로드 시 재시도 로직)** - 방안 1과 함께 적용
3. **방안 3 (수동 생성)** - 임시 해결책
4. **방안 4 (환경 변수 확인)** - 문제 지속 시 확인

## 🔬 추가 디버깅 필요 사항

1. **서버 로그 확인**:
   - `[STORAGE]` 로그에서 버킷 목록 조회 결과 확인
   - 버킷 이름 비교 로그 확인
   - 업로드 에러 상세 메시지 확인

2. **Supabase Dashboard 확인**:
   - Storage → Buckets에서 버킷이 실제로 보이는지 확인
   - 버킷 설정 확인 (Public, File size limit, Allowed MIME types)

3. **네트워크 요청 확인**:
   - 브라우저 개발자 도구에서 실제 API 요청/응답 확인
   - Supabase Storage API 호출 시 에러 메시지 확인

## 📝 결론

**핵심 문제**: SQL로 직접 생성한 버킷 레코드가 Supabase Storage API에서 인식되지 않음

**가장 가능성 높은 원인**: Supabase Storage API는 내부 메타데이터나 캐시를 사용하여 버킷 목록을 관리하며, SQL로 직접 삽입한 레코드가 이 메타데이터와 동기화되지 않았을 가능성이 높음.

**권장 해결책**: Storage API의 `createBucket()` 메서드를 사용하여 버킷을 생성하거나, Supabase Dashboard에서 수동으로 버킷을 생성하는 것이 가장 확실한 방법입니다.

