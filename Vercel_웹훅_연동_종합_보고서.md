# Vercel 기반 GitHub Webhook 연동 종합 보고서

## 📋 목차

1. [개요](#개요)
2. [아키텍처](#아키텍처)
3. [웹훅 생성 및 설정](#웹훅-생성-및-설정)
4. [웹훅 수신 및 처리 플로우](#웹훅-수신-및-처리-플로우)
5. [잠금 메커니즘 (Job Locks)](#잠금-메커니즘-job-locks)
6. [주요 코드 분석](#주요-코드-분석)
7. [환경 변수 및 설정](#환경-변수-및-설정)
8. [에러 처리 및 최근 수정 사항](#에러-처리-및-최근-수정-사항)
9. [테스트 방법](#테스트-방법)
10. [트러블슈팅 가이드](#트러블슈팅-가이드)

---

## 개요

### 목적

GitHub 리포지토리의 `push` 이벤트를 실시간으로 감지하여, 변경된 `.md` 파일만 선택적으로 업데이트하고 RAG(검색 증강 생성) 데이터베이스를 최신 상태로 유지합니다.

### 주요 기능

- **실시간 동기화**: GitHub push 이벤트 자동 감지
- **선택적 업데이트**: 변경된 `.md` 파일만 처리 (Surgical Update)
- **커밋 히스토리 저장**: 웹훅 수신 시 커밋 정보 자동 저장
- **AI 분석 트리거**: 핵심 파일 변경 시 자동 AI 분석 실행
- **릴리즈 노트 생성**: 커밋 메시지 기반 자동 생성
- **동시성 제어**: Job Locks를 통한 중복 처리 방지

### 기술 스택

- **플랫폼**: Vercel (Serverless Functions)
- **프레임워크**: Next.js 14+ (App Router)
- **데이터베이스**: Supabase (PostgreSQL)
- **GitHub API**: @octokit/rest
- **인증**: HMAC SHA-256 서명 검증

---

## 아키텍처

### 전체 플로우 다이어그램

```
┌─────────────────┐
│   GitHub Repo   │
│   (Push Event)  │
└────────┬────────┘
         │
         │ HTTP POST
         │ (x-hub-signature-256)
         ▼
┌─────────────────────────────────┐
│   Vercel Serverless Function    │
│   /api/github/webhook           │
│                                 │
│   1. HMAC 서명 검증             │
│   2. 프로젝트 조회              │
│   3. Job Lock 획득              │
│   4. 파일 처리                  │
│   5. AI 분석 (조건부)           │
│   6. Job Lock 해제              │
└────────┬────────────────────────┘
         │
         ├─────────────────┬─────────────────┐
         ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Supabase   │  │   Supabase   │  │   OpenAI     │
│   Database   │  │   Storage    │  │   API        │
│              │  │              │  │              │
│ - projects   │  │ - repo-files │  │ - Embeddings │
│ - repo_files │  │   bucket     │  │ - Analysis   │
│ - chunks     │  │              │  │              │
│ - commits    │  │              │  │              │
└──────────────┘  ┌──────────────┘  └──────────────┘
```

### 컴포넌트 구조

```
app/api/github/webhook/
├── route.ts                    # 웹훅 수신 엔드포인트
│
app/api/projects/[id]/
├── create-webhook/route.ts     # 웹훅 생성 API
├── webhook-status/route.ts     # 웹훅 상태 확인 API
└── route.ts                    # 프로젝트 삭제 시 웹훅 삭제
│
lib/
├── github.ts                   # GitHub API 유틸리티
│   ├── createWebhook()         # 웹훅 생성
│   ├── listWebhooks()          # 웹훅 목록 조회
│   └── getFileContentWithSha() # 파일 내용 조회
├── storage.ts                  # Supabase Storage 유틸리티
├── rag.ts                      # RAG 처리 (chunking, embedding)
└── analysisService.ts          # AI 분석 서비스
```

---

## 웹훅 생성 및 설정

### 1. 자동 생성 (프로젝트 임포트 시)

**API 엔드포인트**: `POST /api/projects/import`

**처리 과정**:
1. 프로젝트 임포트 시 자동으로 웹훅 생성
2. GitHub API를 통해 웹훅 등록
3. 생성된 `webhook_id`를 `projects` 테이블에 저장

**코드 위치**: `app/api/projects/import/route.ts:175-192`

```typescript
// 웹훅 URL 구성
const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/github/webhook`;
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET!;

// GitHub에 웹훅 생성
const webhook = await createWebhook(
  systemUser.githubAccessToken,
  repo_owner,
  repo_name,
  webhookUrl,
  webhookSecret
);

// DB에 webhook_id 저장
await supabaseAdmin
  .from('projects')
  .insert({
    // ...
    webhook_id: webhook.id,
  });
```

### 2. 수동 생성 (기존 프로젝트)

**API 엔드포인트**: `POST /api/projects/[id]/create-webhook`

**요청 예시**:
```bash
POST /api/projects/{projectId}/create-webhook
```

**응답 예시**:
```json
{
  "success": true,
  "message": "웹훅이 성공적으로 생성되었습니다.",
  "webhook": {
    "id": 12345678,
    "url": "https://vibememory.vercel.app/api/github/webhook",
    "repo_owner": "username",
    "repo_name": "repository"
  }
}
```

**코드 위치**: `app/api/projects/[id]/create-webhook/route.ts`

### 3. GitHub 웹훅 설정

**웹훅 구성**:
- **URL**: `{NEXT_PUBLIC_APP_URL}/api/github/webhook`
- **Content type**: `application/json`
- **Secret**: `GITHUB_WEBHOOK_SECRET` 환경 변수 값
- **Events**: `push` (단일 이벤트)
- **Active**: `true`

**GitHub API 요청**:
```typescript
await octokit.repos.createWebhook({
  owner: repo_owner,
  repo: repo_name,
  config: {
    url: webhookUrl,
    content_type: 'json',
    secret: webhookSecret,
    insecure_ssl: '0',
  },
  events: ['push'],
  active: true,
});
```

---

## 웹훅 수신 및 처리 플로우

### 1. 요청 검증

**HMAC SHA-256 서명 검증**:

```typescript
function verifySignature(payload: string, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}
```

**검증 실패 시**: `401 Unauthorized` 반환

### 2. 이벤트 타입 확인

- **push 이벤트만 처리**: 다른 이벤트는 무시하고 `200 OK` 반환
- **헤더 확인**: `x-github-event: push`

### 3. 프로젝트 조회

```typescript
const { data: project } = await supabaseAdmin
  .from('projects')
  .select('id, owner_id')
  .eq('repo_url', repoUrl)
  .eq('owner_id', systemUser.id)
  .single();
```

**조건**:
- `repo_url`이 일치하는 프로젝트
- 시스템 사용자가 소유한 프로젝트만

### 4. 커밋 히스토리 저장

**저장 데이터**:
- `sha`: 커밋 SHA
- `message`: 커밋 메시지
- `author_name`, `author_email`, `author_login`: 작성자 정보
- `commit_date`: 커밋 날짜
- `commit_url`: 커밋 URL

**UPSERT 처리**: 중복 방지를 위해 `project_id,sha` 기준으로 UPSERT

### 5. Job Lock 획득

**목적**: 동시 실행 방지 (중복 처리 방지)

**프로세스**:
1. `claim_job` RPC 호출 (최대 3번 재시도)
2. 실패 시 `force_claim_job` RPC 호출
3. 모든 시도 실패 시 `409 Conflict` 반환

**Job Name 형식**: `webhook:{repoOwner}/{repoName}`

### 6. 파일 처리

#### 6.1 수정된 파일 (Modified)

**처리 과정**:
1. GitHub API로 최신 파일 내용 및 SHA 조회
2. Supabase Storage에 업로드
3. `repo_files` 테이블 업데이트 (SHA, bucket_path)
4. 기존 청크 `is_current = false`로 마킹
5. 새 청크 생성 및 임베딩
6. `insert_repo_file_chunks` RPC로 청크 저장

#### 6.2 추가된 파일 (Added)

**처리 과정**:
1. GitHub API로 파일 내용 및 SHA 조회
2. Supabase Storage에 업로드
3. `repo_files` 테이블에 새 레코드 삽입
4. 청크 생성 및 임베딩
5. `insert_repo_file_chunks` RPC로 청크 저장

#### 6.3 삭제된 파일 (Removed)

**처리 과정**:
1. `repo_files` 테이블에서 파일 조회
2. Supabase Storage에서 파일 삭제
3. `repo_files` 테이블에서 `is_current = false`로 마킹

**필터링**: `.md` 파일만 처리

### 7. AI 분석 트리거

**트리거 조건**:
1. **핵심 파일 수정**: 다음 파일 중 하나가 수정된 경우
   - `projectbrief.md`
   - `techContext.md`
   - `systemPatterns.md`
   - `productContext.md`
   - `activeContext.md`
   - `progress.md`
2. **분석 만료**: 마지막 분석이 1시간 이상 지난 경우 + 파일 변경

**분석 내용**:
- 기술 리뷰 (Tech Review)
- 아이디어 리뷰 (Idea Review)
- 특허 리뷰 (Patent Review)
- 프로젝트 요약 (Project Summary)

### 8. 릴리즈 노트 생성

**생성 조건**: 모든 push 이벤트에서 실행

**프로세스**:
1. 커밋 메시지 수집
2. `generateReleaseNote()` 함수 호출
3. `project_analysis.latest_release_note` 업데이트

### 9. Job Lock 해제

**처리 완료 후**:
```typescript
await supabaseAdmin.rpc('force_claim_job', {
  p_job_name: jobName,
  p_duration: '0 seconds', // 즉시 만료
});
```

**에러 발생 시**: 에러 핸들러에서도 잠금 해제 시도

---

## 잠금 메커니즘 (Job Locks)

### 목적

동일한 리포지토리에 대한 웹훅이 동시에 여러 번 실행되는 것을 방지하여:
- 중복 처리 방지
- 리소스 낭비 방지
- 데이터 일관성 보장

### Job Name 형식

```
webhook:{repoOwner}/{repoName}
```

**예시**: `webhook:username/repository-name`

### RPC 함수

#### 1. `claim_job`

**목적**: 잠금 획득 시도

**파라미터**:
- `p_job_name`: Job 이름
- `p_duration`: 잠금 유지 시간 (예: `'30 minutes'`)

**동작**:
- 만료된 잠금 자동 정리
- 잠금이 없으면 생성하고 `true` 반환
- 잠금이 있으면 `false` 반환

**코드 위치**: Supabase RPC 함수 (PostgreSQL)

#### 2. `force_claim_job`

**목적**: 강제로 잠금 획득 (기존 잠금 덮어쓰기)

**파라미터**:
- `p_job_name`: Job 이름
- `p_duration`: 잠금 유지 시간

**사용 시점**:
- `claim_job`이 3번 모두 실패한 경우
- 잠금 해제 시 (`duration: '0 seconds'`)

### 잠금 테이블 구조

**테이블**: `vibememory.job_locks`

**컬럼**:
- `job_name`: Job 이름 (Primary Key)
- `expires_at`: 만료 시간 (Timestamp)
- `created_at`: 생성 시간 (Timestamp)

**스키마**: `vibememory` (public 스키마가 아님)

**주의사항**: 
- 직접 테이블 접근 시 `PGRST205` 에러 발생 가능
- RPC 함수를 통해서만 접근해야 함

### 최근 수정 사항 (2025-01-XX)

**문제**: `job_locks` 테이블 직접 접근으로 인한 `PGRST205` 에러

**해결**:
- 테이블 직접 접근 코드 제거
- RPC 함수만 사용하도록 변경
- 에러 발생 시 무시 (비중요 작업)

---

## 주요 코드 분석

### 1. 웹훅 수신 엔드포인트

**파일**: `app/api/github/webhook/route.ts`

**주요 함수**:

#### `verifySignature()`
```typescript
function verifySignature(payload: string, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}
```

**보안**: `crypto.timingSafeEqual()` 사용으로 타이밍 공격 방지

#### `POST()` 핸들러
- 전체 웹훅 처리 플로우 구현
- 에러 핸들링 및 잠금 관리 포함

### 2. 웹훅 생성 API

**파일**: `app/api/projects/[id]/create-webhook/route.ts`

**주요 기능**:
- 중복 웹훅 확인
- GitHub API를 통한 웹훅 생성
- DB에 `webhook_id` 저장

### 3. GitHub 유틸리티

**파일**: `lib/github.ts`

**주요 함수**:

#### `createWebhook()`
```typescript
export async function createWebhook(
  accessToken: string,
  owner: string,
  repo: string,
  webhookUrl: string,
  webhookSecret: string
) {
  const octokit = createGitHubClient(accessToken);
  const { data } = await octokit.repos.createWebhook({
    owner,
    repo,
    config: {
      url: webhookUrl,
      content_type: 'json',
      secret: webhookSecret,
      insecure_ssl: '0',
    },
    events: ['push'],
    active: true,
  });
  return data;
}
```

#### `getFileContentWithSha()`
- GitHub API로 파일 내용 및 SHA 조회
- Base64 디코딩 처리

### 4. 파일 처리 로직

**수정된 파일 처리**:
```typescript
// 1. GitHub에서 최신 파일 조회
const { content, sha: fileSha } = await getFileContentWithSha(
  accessToken, repoOwner, repoName, filePath
);

// 2. Storage 업로드
const bucketPath = await uploadFileToStorage(
  projectId, fileSha, filePath, content
);

// 3. DB 업데이트
await supabaseAdmin
  .from('repo_files')
  .update({
    sha: fileSha,
    bucket_path: bucketPath,
    size: content.length,
    updated_at: new Date().toISOString(),
  })
  .eq('id', repoFile.id);

// 4. 기존 청크 비활성화
await supabaseAdmin
  .from('repo_file_chunks')
  .update({ is_current: false })
  .eq('repo_file_id', repoFile.id)
  .eq('is_current', true);

// 5. 새 청크 생성 및 임베딩
const chunks = chunkText(content, filePath);
const embeddings = await embedChunks(chunks);

// 6. RPC로 청크 저장
await supabaseAdmin.rpc('insert_repo_file_chunks', {
  p_chunks: chunksToInsert,
});
```

---

## 환경 변수 및 설정

### 필수 환경 변수

#### 1. `GITHUB_WEBHOOK_SECRET`
- **용도**: HMAC 서명 검증
- **형식**: 임의의 문자열 (최소 32자 권장)
- **생성 방법**: 
  ```bash
  openssl rand -hex 32
  ```
- **설정 위치**: 
  - Vercel: Settings → Environment Variables
  - 로컬: `.env.local`

#### 2. `NEXT_PUBLIC_APP_URL`
- **용도**: 웹훅 URL 구성
- **형식**: `https://your-project.vercel.app`
- **예시**: `https://vibememory.vercel.app`

#### 3. `OPENAI_API_KEY`
- **용도**: AI 분석 및 임베딩 생성
- **형식**: `sk-...`

#### 4. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **용도**: Supabase 데이터베이스 접근
- **형식**: Supabase 프로젝트 설정에서 확인

### Vercel 환경 변수 설정

1. **Vercel Dashboard** 접속
2. **Project Settings** → **Environment Variables**
3. 다음 변수 추가:
   ```
   GITHUB_WEBHOOK_SECRET=your-secret-here
   NEXT_PUBLIC_APP_URL=https://your-project.vercel.app
   OPENAI_API_KEY=sk-...
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```

### GitHub 웹훅 Secret 설정

1. **GitHub 리포지토리** → **Settings** → **Webhooks**
2. 웹훅 선택 또는 생성
3. **Secret** 필드에 `GITHUB_WEBHOOK_SECRET` 값 입력
4. **Update webhook** 클릭

**중요**: GitHub의 Secret과 Vercel의 `GITHUB_WEBHOOK_SECRET`이 정확히 일치해야 함

---

## 에러 처리 및 최근 수정 사항

### 주요 에러 처리

#### 1. 서명 검증 실패
- **상태 코드**: `401 Unauthorized`
- **응답**: `{ error: 'Invalid signature' }`
- **원인**: Secret 불일치 또는 요청 변조

#### 2. 프로젝트를 찾을 수 없음
- **상태 코드**: `404 Not Found`
- **응답**: `{ error: 'Project not found' }`
- **원인**: `repo_url` 불일치 또는 시스템 사용자 소유 아님

#### 3. 잠금 획득 실패
- **상태 코드**: `409 Conflict`
- **응답**: `{ message: 'Another webhook processing is in progress...' }`
- **원인**: 동일한 리포지토리에 대한 웹훅이 이미 실행 중

#### 4. GitHub Access Token 없음
- **상태 코드**: `200 OK` (성공으로 처리)
- **응답**: `{ message: 'Webhook received but access token unavailable' }`
- **원인**: 시스템 사용자의 GitHub Access Token 미설정
- **동작**: 웹훅은 수신했지만 파일 처리 스킵

### 최근 수정 사항 (2025-01-XX)

#### 1. Job Locks 테이블 접근 오류 수정

**문제**:
```
[WEBHOOK] Error cleaning up expired locks: { 
  code: 'PGRST205', 
  message: "Could not find the table 'public.job_locks' in the schema cache" 
}
```

**원인**:
- `job_locks` 테이블이 `vibememory` 스키마에 있음
- `public` 스키마에서 직접 접근 시도

**해결**:
- 테이블 직접 접근 코드 제거
- RPC 함수(`claim_job`, `force_claim_job`)만 사용
- 만료된 잠금 정리는 RPC 함수가 자동 처리

**변경 전**:
```typescript
// ❌ 직접 테이블 접근
await supabaseAdmin
  .from('job_locks')
  .delete()
  .eq('job_name', jobName)
  .lt('expires_at', new Date().toISOString());
```

**변경 후**:
```typescript
// ✅ RPC 함수 사용 (만료된 잠금 자동 정리)
await supabaseAdmin.rpc('claim_job', {
  p_job_name: jobName,
  p_duration: '30 minutes',
});
```

#### 2. 잠금 해제 로직 개선

**변경 전**:
```typescript
// ❌ 직접 테이블 접근
await supabaseAdmin
  .from('job_locks')
  .delete()
  .eq('job_name', jobName);
```

**변경 후**:
```typescript
// ✅ RPC 함수 사용 (에러 무시)
try {
  await supabaseAdmin.rpc('force_claim_job', {
    p_job_name: jobName,
    p_duration: '0 seconds', // 즉시 만료
  });
} catch (error) {
  // 잠금 해제 실패해도 무시 (이미 처리 완료)
  console.log(`[WEBHOOK] Lock cleanup attempted`);
}
```

### 에러 로깅

**로깅 레벨**:
- `console.log()`: 정상 처리 로그
- `console.warn()`: 경고 (처리 계속)
- `console.error()`: 에러 (처리 중단 또는 스킵)

**로그 예시**:
```
[WEBHOOK] Webhook request received
[WEBHOOK] Event type: push
[WEBHOOK] Processing push event for username/repository
[WEBHOOK] Commits: 3
[WEBHOOK] Found project: abc-123-def
[WEBHOOK] Saved 3 commits to commit_history
[WEBHOOK] Successfully claimed job on attempt 1
[WEBHOOK] Files to process - Modified: 2, Added: 1, Removed: 0
[WEBHOOK] Triggering AI analysis (coreFilesModified: true, analysisOutdated: false)
[WEBHOOK] Successfully processed webhook for username/repository
```

---

## 테스트 방법

### 1. 로컬 테스트

#### 1.1 ngrok을 사용한 터널링

```bash
# ngrok 설치
npm install -g ngrok

# 터널 생성
ngrok http 3000

# 출력된 URL을 GitHub 웹훅 URL로 설정
# 예: https://abc123.ngrok.io/api/github/webhook
```

#### 1.2 GitHub 웹훅 테스트

1. **GitHub 리포지토리** → **Settings** → **Webhooks**
2. 웹훅 선택 → **Recent Deliveries**
3. **Redeliver** 클릭하여 재전송

#### 1.3 로컬 로그 확인

```bash
# Next.js 개발 서버 실행
npm run dev

# 터미널에서 로그 확인
[WEBHOOK] Webhook request received
[WEBHOOK] Event type: push
...
```

### 2. Vercel 배포 테스트

#### 2.1 웹훅 상태 확인 API

**엔드포인트**: `GET /api/projects/[id]/webhook-status`

**응답 예시**:
```json
{
  "webhook_configured": true,
  "webhook_id": 12345678,
  "webhook_url": "https://vibememory.vercel.app/api/github/webhook",
  "github_webhooks": [
    {
      "id": 12345678,
      "url": "https://vibememory.vercel.app/api/github/webhook",
      "active": true,
      "events": ["push"]
    }
  ]
}
```

#### 2.2 Vercel 로그 확인

1. **Vercel Dashboard** → **Deployments**
2. 최신 배포 선택 → **Functions** 탭
3. `/api/github/webhook` 함수 선택
4. **Logs** 탭에서 실시간 로그 확인

#### 2.3 GitHub 웹훅 Delivery 확인

1. **GitHub 리포지토리** → **Settings** → **Webhooks**
2. 웹훅 선택 → **Recent Deliveries**
3. 각 Delivery의 **Response** 확인:
   - **Status**: `200 OK` (성공)
   - **Response**: `{"message":"Webhook processed successfully"}`

### 3. 수동 테스트

#### 3.1 테스트 커밋 생성

```bash
# 테스트 파일 생성
echo "# Test" > test.md
git add test.md
git commit -m "test: webhook test"
git push
```

#### 3.2 결과 확인

1. **Vercel 로그**에서 웹훅 수신 확인
2. **Supabase Dashboard**에서 다음 확인:
   - `commit_history` 테이블에 커밋 저장됨
   - `repo_files` 테이블에 파일 추가/수정됨
   - `repo_file_chunks` 테이블에 청크 생성됨

---

## 트러블슈팅 가이드

### 문제 1: 웹훅이 수신되지 않음

**증상**:
- GitHub에서 웹훅 Delivery가 실패
- Vercel 로그에 웹훅 요청이 없음

**확인 사항**:
1. **웹훅 URL 확인**
   - GitHub: `Settings` → `Webhooks` → 웹훅 URL
   - Vercel: `NEXT_PUBLIC_APP_URL` 환경 변수
   - 형식: `https://your-project.vercel.app/api/github/webhook`

2. **웹훅 활성화 확인**
   - GitHub 웹훅 설정에서 `Active` 체크박스 확인

3. **Vercel 배포 확인**
   - 최신 배포가 성공했는지 확인
   - Functions 탭에서 `/api/github/webhook` 함수 존재 확인

**해결 방법**:
- 웹훅 URL 재설정
- Vercel 재배포
- GitHub 웹훅 재생성

### 문제 2: 서명 검증 실패 (401)

**증상**:
```
[WEBHOOK] Invalid signature
```

**원인**:
- `GITHUB_WEBHOOK_SECRET` 불일치
- 요청 변조

**해결 방법**:
1. **GitHub 웹훅 Secret 확인**
   - GitHub: `Settings` → `Webhooks` → `Secret` 필드

2. **Vercel 환경 변수 확인**
   - Vercel: `Settings` → `Environment Variables` → `GITHUB_WEBHOOK_SECRET`

3. **일치 확인**
   - GitHub의 Secret과 Vercel의 `GITHUB_WEBHOOK_SECRET`이 정확히 일치해야 함
   - 공백, 줄바꿈 등 주의

4. **재설정**
   - 새 Secret 생성 후 양쪽 모두 업데이트

### 문제 3: 프로젝트를 찾을 수 없음 (404)

**증상**:
```
[WEBHOOK] Project not found for https://github.com/username/repo
```

**원인**:
- `repo_url` 불일치
- 시스템 사용자 소유 아님

**해결 방법**:
1. **프로젝트 조회**
   ```sql
   SELECT id, repo_url, owner_id 
   FROM projects 
   WHERE repo_url LIKE '%username/repo%';
   ```

2. **repo_url 형식 확인**
   - 형식: `https://github.com/{owner}/{repo}`
   - 대소문자 구분 없음 (GitHub는 대소문자 구분)

3. **시스템 사용자 확인**
   - `projects.owner_id`가 시스템 사용자 ID와 일치하는지 확인

### 문제 4: Job Lock 획득 실패 (409)

**증상**:
```
[WEBHOOK] All claim_job attempts failed
[WEBHOOK] force_claim_job also failed
```

**원인**:
- 동일한 리포지토리에 대한 웹훅이 이미 실행 중
- 잠금이 만료되지 않음

**해결 방법**:
1. **현재 잠금 확인**
   ```sql
   SELECT * FROM vibememory.job_locks 
   WHERE job_name = 'webhook:username/repo';
   ```

2. **수동 잠금 해제** (필요 시)
   - Supabase Dashboard에서 직접 삭제
   - 또는 `/api/projects/import/reset-locks` API 사용

3. **재시도**
   - 잠금 해제 후 GitHub에서 웹훅 재전송

### 문제 5: 파일 처리 실패

**증상**:
```
[WEBHOOK] Error processing modified file path/to/file.md
```

**원인**:
- GitHub Access Token 권한 부족
- 파일이 너무 큼
- 네트워크 오류

**해결 방법**:
1. **GitHub Access Token 권한 확인**
   - `repo` 스코프 필요
   - 만료되지 않았는지 확인

2. **로그 확인**
   - Vercel 로그에서 상세 에러 메시지 확인

3. **수동 재처리**
   - 프로젝트 재스캔 (`POST /api/projects/[id]/rescan`)

### 문제 6: AI 분석이 트리거되지 않음

**증상**:
- 핵심 파일을 수정했는데 AI 분석이 실행되지 않음

**확인 사항**:
1. **핵심 파일 목록 확인**
   - `projectbrief.md`
   - `techContext.md`
   - `systemPatterns.md`
   - `productContext.md`
   - `activeContext.md`
   - `progress.md`

2. **파일 경로 확인**
   - 파일명이 정확히 일치해야 함 (대소문자 구분)
   - 하위 디렉토리에 있어도 됨 (경로에 포함되면 됨)

3. **로그 확인**
   ```
   [WEBHOOK] Triggering AI analysis (coreFilesModified: true, ...)
   ```
   또는
   ```
   [WEBHOOK] Skipping AI analysis (coreFilesModified: false, ...)
   ```

**해결 방법**:
- 파일명 정확히 일치 확인
- 수동 AI 분석 트리거 (프로젝트 재스캔)

### 문제 7: PGRST205 에러 (Job Locks)

**증상**:
```
Error: Could not find the table 'public.job_locks' in the schema cache
```

**원인**:
- `job_locks` 테이블이 `vibememory` 스키마에 있음
- `public` 스키마에서 직접 접근 시도

**해결 방법**:
- ✅ **이미 수정됨** (2025-01-XX)
- RPC 함수만 사용하도록 코드 변경 완료
- 테이블 직접 접근 코드 제거

**확인**:
- 최신 코드에서는 RPC 함수만 사용
- 에러가 발생하면 Vercel 재배포 필요

---

## 보안 고려사항

### 1. HMAC 서명 검증

- **필수**: 모든 웹훅 요청은 HMAC SHA-256 서명 검증
- **보안**: `crypto.timingSafeEqual()` 사용으로 타이밍 공격 방지
- **Secret**: 최소 32자 이상의 랜덤 문자열 권장

### 2. 프로젝트 소유권 확인

- 시스템 사용자가 소유한 프로젝트만 처리
- `repo_url` 기반으로 프로젝트 조회
- 권한 없는 프로젝트는 `404` 반환

### 3. GitHub Access Token

- 시스템 사용자의 Access Token만 사용
- `repo` 스코프 필요
- 민감 정보이므로 환경 변수로 관리

### 4. 에러 메시지

- 상세한 에러 정보는 로그에만 기록
- 클라이언트에는 일반적인 메시지만 반환
- 내부 구조 노출 방지

---

## 성능 최적화

### 1. 선택적 파일 처리

- `.md` 파일만 처리 (필터링)
- 변경된 파일만 업데이트 (Surgical Update)
- 불필요한 처리 최소화

### 2. 비동기 처리

- 파일 처리 및 임베딩은 순차 처리
- 각 파일은 독립적으로 처리 (에러 격리)
- 하나의 파일 실패가 전체 웹훅 실패로 이어지지 않음

### 3. Job Lock

- 동시 실행 방지로 리소스 낭비 방지
- 30분 타임아웃으로 무한 대기 방지
- `force_claim_job`으로 데드락 방지

### 4. AI 분석 최적화

- 핵심 파일 변경 시에만 실행
- 1시간 내 분석이 있으면 스킵
- 불필요한 AI 호출 최소화

---

## 모니터링 및 알림

### 1. Vercel 로그

- **위치**: Vercel Dashboard → Deployments → Functions → Logs
- **확인 항목**:
  - 웹훅 수신 여부
  - 처리 성공/실패
  - 에러 메시지

### 2. GitHub 웹훅 Delivery

- **위치**: GitHub → Settings → Webhooks → Recent Deliveries
- **확인 항목**:
  - HTTP Status Code
  - Response Body
  - Delivery Time

### 3. Supabase 로그

- **위치**: Supabase Dashboard → Logs
- **확인 항목**:
  - RPC 함수 호출
  - 테이블 업데이트
  - 에러 발생

### 4. 커스텀 모니터링 (향후)

- 웹훅 처리 시간 측정
- 실패율 추적
- 알림 설정 (Slack, Email 등)

---

## 향후 개선 사항

### 1. 웹훅 재시도 메커니즘

- 일시적 오류 시 자동 재시도
- Exponential Backoff 적용
- 최대 재시도 횟수 제한

### 2. 배치 처리

- 여러 파일을 한 번에 처리
- 병렬 임베딩 생성
- 처리 시간 단축

### 3. 웹훅 상태 대시보드

- 웹훅 성공/실패 통계
- 처리 시간 그래프
- 최근 처리 내역

### 4. 알림 시스템

- 웹훅 실패 시 알림
- 처리 완료 알림
- 에러 발생 시 즉시 알림

---

## 참고 자료

### 관련 문서

- [Vercel Deployment Guide](./VERCEL_DEPLOYMENT.md)
- [Database Schema](./DATABASE_SCHEMA.md)
- [Environment Setup](./ENV_SETUP.md)

### GitHub API 문서

- [Webhooks Guide](https://docs.github.com/en/webhooks)
- [Creating Webhooks](https://docs.github.com/en/rest/webhooks/repos#create-a-repository-webhook)
- [Webhook Events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)

### Supabase 문서

- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [RPC Functions](https://supabase.com/docs/guides/database/functions)

---

## 변경 이력

### 2025-01-XX
- Job Locks 테이블 직접 접근 제거
- RPC 함수만 사용하도록 변경
- PGRST205 에러 해결

### 2025-01-XX
- 웹훅 수신 엔드포인트 구현
- HMAC 서명 검증 추가
- Job Lock 메커니즘 구현

---

**작성일**: 2025-01-XX  
**최종 수정일**: 2025-01-XX  
**버전**: 1.0.0

