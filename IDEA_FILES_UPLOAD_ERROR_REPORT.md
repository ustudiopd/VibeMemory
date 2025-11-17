# 아이디어 파일 업로드 실패 오류 보고서

> **작성일**: 2025-01-16  
> **프로젝트**: VibeMemory  
> **엔드포인트**: `/api/projects/[id]/idea/files` (POST)  
> **상태**: 🔴 **미해결**

---

## 📋 요약

아이디어 캔버스에서 `.md` 파일을 업로드할 때 Storage 업로드 단계에서 HTTP 400 에러가 발생하여 파일 업로드가 실패합니다.

**에러 메시지**:
- 클라이언트: "파일 업로드에 실패했습니다. 버킷은 존재하지만 업로드에 실패했습니다."
- 서버: HTTP 400 (Bad Request) - Supabase Storage API

---

## 🔍 증상

### 클라이언트 에러
```
[IDEA FILES] Upload error: {}
파일 업로드에 실패했습니다.
버킷은 존재하지만 업로드에 실패했습니다. 서버 로그를 확인해주세요.
```

### 서버 로그 (Supabase API)
```
POST | 400 | /storage/v1/object/idea-project-files/{project_id}/{file_id}/Simple100AgentV01_1763344982150_s8wtx1p.md
```

**관찰된 사실**:
- ✅ 버킷 존재 확인 성공 (`idea-project-files`)
- ✅ 프로젝트 검증 성공
- ✅ 파일 타입 검증 통과 (.md 파일)
- ✅ 파일 크기 검증 통과
- ❌ **Storage 업로드 실패 (HTTP 400)**

---

## 🔬 원인 분석

### 1. HTTP 400 에러의 가능한 원인

#### 🔴 원인 1: MIME 타입 불일치 (가장 유력)

**가설**: 버킷의 `allowed_mime_types` 설정과 실제 업로드되는 파일의 MIME 타입이 일치하지 않음.

**근거**:
- 버킷 설정: `allowed_mime_types: ['text/markdown', 'text/plain']`
- 브라우저가 `.md` 파일을 업로드할 때 MIME 타입을 다르게 감지할 수 있음
  - 가능한 MIME 타입: `text/markdown`, `text/x-markdown`, `application/x-markdown`, `text/plain`, `application/octet-stream`, 또는 빈 문자열

**검증 필요**:
```typescript
// 실제 업로드 시 전달되는 MIME 타입 확인
console.log('File MIME type:', file.type);
console.log('File name:', file.name);
```

#### 🔴 원인 2: 버킷 정책/권한 문제

**가설**: Service Role Key를 사용한 업로드가 버킷의 정책과 충돌할 수 있음.

**근거**:
- 버킷이 `public: false`로 설정되어 있음
- Service Role Key는 모든 권한을 가져야 하지만, Storage API의 경우 특별한 권한 설정이 필요할 수 있음

#### 🔴 원인 3: 파일명/경로 문제

**가설**: Storage 경로에 사용할 수 없는 문자가 포함되어 있음.

**근거**:
- 현재 파일명 sanitization 로직이 있지만, Supabase Storage의 경로 제약사항과 완전히 일치하지 않을 수 있음
- 경로 형식: `{project_id}/{file_id}/{filename}`

**현재 sanitization 결과**:
- 원본: `Simple100AgentV01.md`
- 변환: `Simple100AgentV01_1763344982150_s8wtx1p.md`

#### 🔴 원인 4: 버킷 설정 문제

**가설**: 버킷의 `allowed_mime_types`가 엄격하게 적용되어 실제 업로드 시 MIME 타입 검증에 실패.

**근거**:
- Supabase Storage는 업로드 시 `contentType`과 버킷의 `allowed_mime_types`를 비교
- 정확히 일치하지 않으면 400 에러 반환

---

## 📊 현재 상태

### 버킷 확인 결과
```sql
SELECT name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE name = 'idea-project-files';

결과:
- name: 'idea-project-files'
- public: false
- file_size_limit: 10485760 (10MB)
- allowed_mime_types: ['text/markdown', 'text/plain']
```

### 코드 흐름
1. ✅ 사용자 인증 확인
2. ✅ 프로젝트 소유 확인
3. ✅ 파일 존재 확인
4. ✅ 파일 타입 검증 (.md, .txt)
5. ✅ 파일 크기 검증 (10MB 이하)
6. ✅ 버킷 존재 확인
7. ✅ 파일명 sanitization
8. ❌ **Storage 업로드 실패 (HTTP 400)**

---

## 🛠️ 시도한 해결 방법

### 1. 에러 로깅 강화
- ✅ 각 단계별 상세 로그 추가
- ✅ Storage 에러 상세 정보 로깅
- ✅ 파일 정보 로깅

### 2. 파일명 sanitization 개선
- ✅ 한글 제거
- ✅ 특수문자 처리
- ✅ 영문/숫자만 사용하는 안전한 파일명 생성

### 3. 재시도 로직 추가
- ✅ "Bucket not found" 에러 시 재시도
- ✅ 캐시 초기화 후 재검증

### 4. 에러 메시지 개선
- ✅ 사용자 친화적 에러 메시지
- ✅ 서버 로그 확인 안내

**결과**: 문제 해결되지 않음. HTTP 400 에러 지속.

---

## 💡 해결 방안

### 방안 1: MIME 타입 처리 개선 (우선순위: 높음)

**문제**: 브라우저가 `.md` 파일의 MIME 타입을 다르게 감지할 수 있음.

**해결책**:
```typescript
// 파일 타입 검증 후 MIME 타입 정규화
let normalizedMimeType = file.type;

// .md 파일의 경우 text/markdown으로 강제 설정
if (fileExtension === '.md') {
  normalizedMimeType = 'text/markdown';
} else if (fileExtension === '.txt') {
  normalizedMimeType = 'text/plain';
}

// 빈 문자열이거나 허용되지 않은 타입인 경우 기본값 설정
if (!normalizedMimeType || !allowedTypes.includes(normalizedMimeType)) {
  normalizedMimeType = fileExtension === '.md' ? 'text/markdown' : 'text/plain';
}
```

**적용 위치**: `app/api/projects/[id]/idea/files/route.ts` (파일 타입 검증 후)

### 방안 2: 버킷 설정 확인 및 수정

**문제**: 버킷의 `allowed_mime_types`가 엄격하게 설정되어 있을 수 있음.

**해결책**:
1. Supabase Dashboard에서 버킷 설정 확인
2. `allowed_mime_types`에 추가 MIME 타입 포함:
   - `text/markdown`
   - `text/x-markdown`
   - `text/plain`
   - `application/x-markdown` (선택)

**또는**:
- `allowed_mime_types` 제한을 완화하거나 제거 (개발 환경에서만)

### 방안 3: Storage 업로드 옵션 조정

**문제**: `contentType`이 버킷 설정과 정확히 일치하지 않을 수 있음.

**해결책**:
```typescript
// 업로드 시 MIME 타입을 명시적으로 설정
const uploadOptions: any = {
  upsert: true,
};

// 버킷의 allowed_mime_types에 맞는 타입만 사용
if (fileExtension === '.md') {
  uploadOptions.contentType = 'text/markdown';
} else if (fileExtension === '.txt') {
  uploadOptions.contentType = 'text/plain';
} else {
  uploadOptions.contentType = 'text/plain'; // 기본값
}

const { data, error } = await supabaseAdmin.storage
  .from(IDEA_FILES_BUCKET_NAME)
  .upload(storagePath, fileBuffer, uploadOptions);
```

### 방안 4: 버킷 정책 확인

**문제**: Service Role Key를 사용한 업로드가 버킷 정책과 충돌할 수 있음.

**해결책**:
1. Supabase Dashboard → Storage → Policies 확인
2. Service Role Key가 버킷에 접근할 수 있는지 확인
3. 필요시 RLS 정책 수정 또는 비활성화

### 방안 5: 디버깅 정보 수집

**문제**: 실제 에러 원인을 정확히 파악하기 어려움.

**해결책**:
```typescript
// Storage 업로드 전 모든 정보 로깅
console.log('[STORAGE] Upload attempt:', {
  bucket: IDEA_FILES_BUCKET_NAME,
  path: storagePath,
  contentType: mimeType || 'text/plain',
  fileSize: fileBuffer.byteLength,
  fileExtension,
  normalizedMimeType,
});

// 에러 발생 시 Supabase Storage API의 실제 응답 확인
if (error) {
  console.error('[STORAGE] Full error response:', {
    message: error.message,
    statusCode: (error as any).statusCode,
    statusText: (error as any).statusText,
    error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
  });
}
```

---

## 🔍 추가 조사 필요 사항

### 1. 실제 MIME 타입 확인
- 브라우저 개발자 도구에서 FormData 확인
- 서버 로그에서 `file.type` 값 확인

### 2. Supabase Storage API 문서 확인
- HTTP 400 에러의 정확한 의미
- `allowed_mime_types` 검증 로직
- Service Role Key 권한 범위

### 3. 네트워크 요청 분석
- 브라우저 개발자 도구 → Network 탭
- `/storage/v1/object/idea-project-files/...` 요청 확인
- 요청 헤더 및 본문 확인
- 응답 본문 확인 (에러 메시지)

### 4. 다른 파일 타입 테스트
- `.txt` 파일 업로드 테스트
- 다른 MIME 타입의 파일 테스트

---

## 📝 권장 조치 사항

### 즉시 조치 (우선순위: 높음)

1. **MIME 타입 정규화 로직 추가**
   - 파일 확장자 기반으로 MIME 타입 강제 설정
   - 버킷의 `allowed_mime_types`와 정확히 일치하도록 보장

2. **디버깅 로그 추가**
   - 실제 업로드 시 전달되는 모든 파라미터 로깅
   - Supabase Storage API의 실제 에러 응답 로깅

3. **네트워크 요청 분석**
   - 브라우저 개발자 도구에서 실제 요청/응답 확인
   - Supabase Storage API의 에러 메시지 확인

### 중기 조치 (우선순위: 중간)

1. **버킷 설정 검토**
   - `allowed_mime_types` 설정 확인 및 필요시 수정
   - 버킷 정책 확인

2. **에러 처리 개선**
   - HTTP 400 에러에 대한 구체적인 에러 메시지 반환
   - 사용자에게 더 명확한 안내 제공

### 장기 조치 (우선순위: 낮음)

1. **통합 테스트 추가**
   - 파일 업로드 E2E 테스트
   - 다양한 파일 타입 및 크기 테스트

2. **모니터링 추가**
   - 파일 업로드 실패율 모니터링
   - 에러 알림 설정

---

## 🔗 관련 파일

- `app/api/projects/[id]/idea/files/route.ts` - API 라우트
- `lib/storage.ts` - Storage 업로드 함수
- `components/IdeaNoteTab.tsx` - 클라이언트 컴포넌트

---

## 📌 참고 자료

- [Supabase Storage API 문서](https://supabase.com/docs/reference/javascript/storage-from-upload)
- [Supabase Storage 버킷 설정](https://supabase.com/docs/guides/storage/buckets)
- [HTTP 400 Bad Request](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400)

---

## ✅ 체크리스트

- [ ] MIME 타입 정규화 로직 추가
- [ ] 디버깅 로그 추가 및 실제 에러 메시지 확인
- [ ] 네트워크 요청 분석
- [ ] 버킷 설정 확인 및 수정
- [ ] 다른 파일 타입 테스트
- [ ] Supabase Storage API 문서 확인
- [ ] 에러 처리 개선
- [ ] 통합 테스트 추가

---

**작성자**: AI Assistant  
**최종 업데이트**: 2025-01-16

