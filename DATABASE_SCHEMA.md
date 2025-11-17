# VibeMemory 데이터베이스 스키마 문서

> **업데이트 날짜**: 2025-11-16  
> **데이터베이스**: PostgreSQL (Supabase)  
> **스키마**: `vibememory`  
> **벡터 확장**: pgvector (HNSW 인덱스)

---

## 목차

1. [개요](#개요)
2. [핵심 테이블](#핵심-테이블)
3. [챗봇 관련 테이블](#챗봇-관련-테이블)
4. [아이디어 프로젝트 테이블](#아이디어-프로젝트-테이블)
5. [스크린샷 갤러리 테이블](#스크린샷-갤러리-테이블)
6. [인덱스](#인덱스)
7. [RLS (Row Level Security) 정책](#rls-row-level-security-정책)
8. [RPC 함수](#rpc-함수)
9. [Storage 버킷](#storage-버킷)

---

## 개요

VibeMemory는 PostgreSQL 데이터베이스를 사용하며, `vibememory` 스키마로 격리하여 운영합니다. 주요 기능:

- **GitHub 프로젝트**: GitHub 리포지토리를 가져와 RAG 지식베이스로 변환
- **아이디어 프로젝트**: 아이디어 단계의 프로젝트를 관리하고 AI와 함께 발전시킴
- **RAG 검색**: pgvector를 활용한 하이브리드 검색 (FTS + 벡터 유사도)
- **챗봇**: 프로젝트별 AI 챗봇 세션 및 메시지 관리
- **스크린샷 갤러리**: 프로젝트 스크린샷 및 댓글 관리

---

## 핵심 테이블

### 1. `vibememory.projects`

프로젝트 메인 테이블. GitHub 프로젝트와 아이디어 프로젝트를 모두 관리합니다.

```sql
CREATE TABLE vibememory.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- 프로젝트 타입 (ENUM: 'github' | 'idea')
  project_type vibememory.project_type NOT NULL DEFAULT 'github',
  
  -- 프로젝트 기본 정보
  project_name text,                    -- 프로젝트 이름 (아이디어 프로젝트 필수)
  description text,                     -- 프로젝트 설명
  tech_spec text,                       -- 기술 스펙
  deployment_url text,                  -- 배포 URL
  repository_url text,                  -- 저장소 URL (일반)
  documentation_url text,               -- 문서 URL
  
  -- GitHub 관련 필드 (project_type = 'github'일 때 필수)
  repo_owner text,                      -- GitHub 리포지토리 소유자
  repo_name text,                       -- GitHub 리포지토리 이름
  repo_url text,                        -- GitHub 리포지토리 URL
  webhook_id bigint,                    -- GitHub Webhook ID
  
  -- 타임스탬프
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- 제약 조건
  CONSTRAINT projects_github_requires_repo_url 
    CHECK (
      (project_type = 'github' AND repo_url IS NOT NULL) OR 
      (project_type = 'idea')
    )
);
```

**인덱스:**
- `idx_projects_owner_id` ON `owner_id`
- `idx_projects_project_type` ON `project_type`
- `idx_projects_owner_type` ON `owner_id, project_type`

**RLS 정책:**
- `owner_id = auth.uid()` 기준으로 모든 작업 제한

---

### 2. `vibememory.repo_files` (GitHub 프로젝트용)

GitHub 리포지토리의 파일 메타데이터를 저장합니다.

```sql
CREATE TABLE vibememory.repo_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  path text NOT NULL,                   -- 파일 경로
  sha text NOT NULL,                    -- Git SHA
  size integer NOT NULL,                -- 파일 크기 (bytes)
  is_current boolean NOT NULL DEFAULT true,  -- 현재 버전 여부
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(project_id, path, sha)
);
```

**인덱스:**
- `idx_repo_files_project_id` ON `project_id`
- `idx_repo_files_path` ON `path`
- `idx_repo_files_is_current` ON `project_id, is_current` WHERE `is_current = true`

---

### 3. `vibememory.repo_file_chunks` (GitHub 프로젝트용 RAG)

GitHub 프로젝트의 파일을 청크 단위로 나누어 RAG 검색을 위한 벡터 임베딩을 저장합니다.

```sql
CREATE TABLE vibememory.repo_file_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_file_id uuid NOT NULL REFERENCES vibememory.repo_files(id) ON DELETE CASCADE,
  content text NOT NULL,                -- 청크 내용
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,  -- FTS 인덱스
  embedding vector(1536),               -- OpenAI text-embedding-3-small 벡터
  embedding_version text NOT NULL DEFAULT 'text-embedding-3-small',
  is_current boolean NOT NULL DEFAULT true,
  chunk_index integer NOT NULL,         -- 청크 순서
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**인덱스:**
- `idx_repo_file_chunks_fts` USING GIN(`fts`) - Full-Text Search
- `idx_repo_file_chunks_embedding` USING HNSW(`embedding vector_cosine_ops`) - 벡터 유사도 검색
- `idx_repo_file_chunks_repo_file_id` ON `repo_file_id`
- `idx_repo_file_chunks_is_current` ON `repo_file_id, is_current` WHERE `is_current = true`

---

### 4. `vibememory.project_analysis`

AI가 분석한 프로젝트 정보를 저장합니다.

```sql
CREATE TABLE vibememory.project_analysis (
  project_id uuid PRIMARY KEY REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  idea_review text,                     -- 아이디어 리뷰
  tech_review text,                     -- 기술 리뷰
  patent_review text,                   -- 특허 리뷰
  project_overview text,                -- 프로젝트 개요
  latest_release_note text,             -- 최신 릴리즈 노트
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 챗봇 관련 테이블

### 5. `vibememory.chat_sessions`

프로젝트별 챗봇 세션을 관리합니다.

```sql
CREATE TABLE vibememory.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,               -- RLS 키
  title text,                           -- 세션 제목 (자동 생성 또는 사용자 지정)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**인덱스:**
- `idx_chat_sessions_owner_id` ON `owner_id, project_id`
- `idx_chat_sessions_project_id` ON `project_id, updated_at DESC`

**RLS 정책:**
- `owner_id = auth.uid()` 기준으로 모든 작업 제한

---

### 6. `vibememory.chat_messages`

챗봇 세션의 메시지를 저장합니다.

```sql
CREATE TABLE vibememory.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES vibememory.chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system','user','assistant')),
  content text NOT NULL,                -- 메시지 내용
  model text,                           -- 사용된 모델 (예: 'gpt-5-mini')
  tokens_input int DEFAULT 0,           -- 입력 토큰 수
  tokens_output int DEFAULT 0,          -- 출력 토큰 수
  sources jsonb,                        -- 출처 정보 (하위 호환성용, deprecated)
  error text,                           -- 에러 메시지 (있는 경우)
  created_at timestamptz DEFAULT now()
);
```

**인덱스:**
- `idx_chat_messages_session_id` ON `session_id, created_at`

**RLS 정책:**
- 세션의 `owner_id`를 통해 간접적으로 접근 제어

---

### 7. `vibememory.chat_message_citations`

챗봇 메시지의 출처(Citations) 정보를 저장합니다. RAG 검색 결과에서 참조된 청크 정보를 관리합니다.

```sql
CREATE TABLE vibememory.chat_message_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES vibememory.chat_messages(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  file_path text NOT NULL,              -- 파일 경로
  chunk_id uuid REFERENCES vibememory.repo_file_chunks(id) ON DELETE SET NULL,  -- GitHub 프로젝트용
  score real,                           -- 유사도/가중치 (RRF score)
  created_at timestamptz DEFAULT now()
);
```

**인덱스:**
- `idx_chat_message_citations_message_id` ON `message_id`
- `idx_chat_message_citations_chunk_id` ON `chunk_id`
- `idx_chat_message_citations_project_id` ON `project_id`

**RLS 정책:**
- 메시지의 세션을 통해 간접적으로 접근 제어

---

## 아이디어 프로젝트 테이블

### 8. `vibememory.idea_project_files`

아이디어 프로젝트에 업로드된 파일 메타데이터를 저장합니다.

```sql
CREATE TABLE vibememory.idea_project_files (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES vibememory.projects(id) ON DELETE CASCADE NOT NULL,
  owner_id uuid NOT NULL,               -- RLS 키
  file_name text NOT NULL,              -- 파일명
  file_type text,                       -- 파일 타입
  storage_path text NOT NULL,           -- Storage 경로: {project_id}/{file_id}/{filename}
  file_size bigint,                     -- 파일 크기 (bytes)
  mime_type text,                       -- MIME 타입
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz                -- Soft delete
);
```

**인덱스:**
- `idx_idea_project_files_project_id` ON `project_id`
- `idx_idea_project_files_project_id_deleted_at` ON `project_id, deleted_at` WHERE `deleted_at IS NULL`

**RLS 정책:**
- `owner_id = auth.uid()` 기준으로 모든 작업 제한

---

### 9. `vibememory.idea_project_chunks`

아이디어 프로젝트 파일의 RAG용 청크 및 벡터 임베딩을 저장합니다.

```sql
CREATE TABLE vibememory.idea_project_chunks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES vibememory.projects(id) ON DELETE CASCADE NOT NULL,
  file_id uuid REFERENCES vibememory.idea_project_files(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL,                -- 청크 내용
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,  -- FTS 인덱스
  embedding vector(1536),               -- OpenAI text-embedding-3-small 벡터
  embedding_version text NOT NULL DEFAULT 'text-embedding-3-small',
  token_count int,                      -- 토큰 수
  chunk_index integer NOT NULL DEFAULT 0,  -- 청크 순서
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**인덱스:**
- `idx_idea_project_chunks_project_id` ON `project_id`
- `idx_idea_project_chunks_file_id` ON `file_id`
- `idx_idea_project_chunks_fts` USING GIN(`fts`) - Full-Text Search
- `idx_idea_project_chunks_embedding` USING HNSW(`embedding vector_cosine_ops`) - 벡터 유사도 검색

**RLS 정책:**
- 프로젝트의 `owner_id`를 통해 간접적으로 접근 제어

---

## 스크린샷 갤러리 테이블

### 10. `vibememory.project_screenshots`

프로젝트 스크린샷 메타데이터를 저장합니다.

```sql
CREATE TABLE vibememory.project_screenshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,               -- RLS 키
  storage_path text NOT NULL,           -- Storage 경로: {project_id}/{screenshot_id}/{filename}
  file_name text NOT NULL,              -- 파일명
  file_size bigint NOT NULL,            -- 파일 크기 (bytes)
  mime_type text NOT NULL CHECK (mime_type LIKE 'image/%'),  -- 이미지 MIME 타입만 허용
  width int,                            -- 이미지 너비 (픽셀)
  height int,                           -- 이미지 높이 (픽셀)
  checksum_sha256 text,                 -- SHA256 체크섬 (중복 방지/무결성 확인)
  caption text,                         -- 캡션
  alt_text text,                        -- 대체 텍스트
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  position double precision NOT NULL DEFAULT 1000,  -- 리오더 편의용 부동소수 포지션
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz                -- Soft delete
);
```

**인덱스:**
- `idx_project_screenshots_project_id_position` ON `project_id, position`
- `idx_project_screenshots_project_id_created_at` ON `project_id, created_at`
- `idx_project_screenshots_project_id_deleted_at` ON `project_id, deleted_at` WHERE `deleted_at IS NULL`

**RLS 정책:**
- `owner_id = auth.uid()` 기준으로 모든 작업 제한

---

### 11. `vibememory.screenshot_comments`

스크린샷에 대한 댓글을 저장합니다.

```sql
CREATE TABLE vibememory.screenshot_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screenshot_id uuid NOT NULL REFERENCES vibememory.project_screenshots(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,              -- 댓글 작성자
  content text NOT NULL,                -- 댓글 내용 (마크다운)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz                -- Soft delete
);
```

**인덱스:**
- `idx_screenshot_comments_screenshot_id_created_at` ON `screenshot_id, created_at`
- `idx_screenshot_comments_project_id_created_at` ON `project_id, created_at`

**RLS 정책:**
- 작성자(`author_id`) 또는 프로젝트 소유자(`owner_id`)만 접근 가능

---

## 인덱스

### 벡터 검색 인덱스 (HNSW)

- **`repo_file_chunks.embedding`**: GitHub 프로젝트 청크 벡터 검색
- **`idea_project_chunks.embedding`**: 아이디어 프로젝트 청크 벡터 검색

**설정:**
- 알고리즘: HNSW (Hierarchical Navigable Small World)
- 차원: 1536 (OpenAI text-embedding-3-small)
- 거리 함수: `vector_cosine_ops` (코사인 유사도)
- 파라미터: `m = 16, ef_construction = 64`

### Full-Text Search 인덱스 (GIN)

- **`repo_file_chunks.fts`**: GitHub 프로젝트 청크 FTS
- **`idea_project_chunks.fts`**: 아이디어 프로젝트 청크 FTS

**설정:**
- 언어: `english`
- 인덱스 타입: GIN

---

## RLS (Row Level Security) 정책

모든 테이블에 RLS가 활성화되어 있으며, 기본 정책은 다음과 같습니다:

### 기본 정책 패턴

1. **직접 소유권 기반** (`owner_id = auth.uid()`)
   - `projects`
   - `project_screenshots`
   - `idea_project_files`
   - `chat_sessions`

2. **간접 소유권 기반** (관계 테이블을 통해 확인)
   - `chat_messages` → `chat_sessions.owner_id`
   - `chat_message_citations` → `chat_messages` → `chat_sessions.owner_id`
   - `repo_file_chunks` → `repo_files` → `projects.owner_id`
   - `idea_project_chunks` → `idea_project_files` → `projects.owner_id`

3. **작성자 또는 소유자 기반**
   - `screenshot_comments`: `author_id = auth.uid()` OR 프로젝트 소유자

### 주의사항

현재 프로젝트는 **시스템 사용자 패턴**을 사용하므로, API에서는 `supabaseAdmin`을 사용하여 RLS를 우회합니다. RLS 정책은 추가 보안 레이어로만 작동합니다.

---

## RPC 함수

### 검색 함수

#### 1. `search_project_chunks_rrf`

GitHub 프로젝트 범위의 하이브리드 검색 (RRF: Reciprocal Rank Fusion)

```sql
FUNCTION search_project_chunks_rrf(
  p_project_id uuid,
  p_query_text text,
  p_query_vec float8[],
  p_limit int DEFAULT 8
)
RETURNS TABLE (
  chunk_id uuid,
  file_path text,
  content text,
  fts_rank real,
  vector_similarity real,
  rrf_score real
)
```

**동작:**
- FTS (Full-Text Search)와 벡터 유사도 검색을 결합
- RRF 알고리즘으로 결과 통합
- 프로젝트 범위로 검색 제한

---

#### 2. `search_idea_project_chunks_rrf`

아이디어 프로젝트 범위의 하이브리드 검색 (RRF)

```sql
FUNCTION search_idea_project_chunks_rrf(
  p_project_id uuid,
  p_query_text text,
  p_query_vec float8[],
  p_limit int DEFAULT 8
)
RETURNS TABLE (
  chunk_id uuid,
  file_path text,
  content text,
  fts_rank real,
  vector_similarity real,
  rrf_score real
)
```

**동작:**
- `idea_project_chunks` 테이블에서 검색
- FTS + 벡터 유사도 검색 결합
- RRF 알고리즘으로 결과 통합

---

#### 3. `hybrid_search_rrf` (전역 검색)

모든 프로젝트를 대상으로 한 하이브리드 검색 (폴백용)

```sql
FUNCTION hybrid_search_rrf(
  p_query_text text,
  p_query_embedding float8[],
  p_project_id uuid,
  p_limit int DEFAULT 8,
  p_memory_bank_weight real DEFAULT 1.2
)
RETURNS TABLE (...)
```

---

### 벡터 삽입 함수

#### 4. `insert_idea_project_chunks`

아이디어 프로젝트 청크를 벡터 타입으로 변환하여 삽입

```sql
FUNCTION insert_idea_project_chunks(
  p_chunks jsonb
)
RETURNS void
```

**동작:**
- JSONB 배열을 받아 `idea_project_chunks` 테이블에 삽입
- `float8[]` 배열을 `vector(1536)` 타입으로 변환

---

## Storage 버킷

### 1. `project-screenshots`

프로젝트 스크린샷 이미지 저장

**경로 구조:**
```
{project_id}/{screenshot_id}/{filename}
```

**RLS 정책:**
- 프로젝트 소유자만 업로드/조회/삭제 가능
- `storage.objects` 테이블에 정책 적용

---

### 2. `idea-project-files`

아이디어 프로젝트 파일 저장 (.md, .txt)

**경로 구조:**
```
{project_id}/{file_id}/{filename}
```

**설정:**
- 비공개 버킷
- 파일 크기 제한: 10MB
- 허용 MIME 타입: `text/markdown`, `text/plain`

---

## ENUM 타입

### `vibememory.project_type`

프로젝트 타입을 구분하는 ENUM

```sql
CREATE TYPE vibememory.project_type AS ENUM ('github', 'idea');
```

- **`github`**: GitHub 리포지토리에서 가져온 프로젝트
- **`idea`**: 아이디어 단계의 프로젝트 (GitHub 리포지토리 없음)

---

## Public 스키마 뷰

PostgREST 호환성을 위해 `public` 스키마에 뷰를 생성합니다:

- `public.projects` → `vibememory.projects`
- `public.chat_sessions` → `vibememory.chat_sessions`
- `public.chat_messages` → `vibememory.chat_messages`
- `public.chat_message_citations` → `vibememory.chat_message_citations`
- `public.project_screenshots` → `vibememory.project_screenshots`
- `public.screenshot_comments` → `vibememory.screenshot_comments`
- `public.idea_project_files` → `vibememory.idea_project_files`
- `public.idea_project_chunks` → `vibememory.idea_project_chunks`

**보안:**
- 뷰는 `security_invoker = true`로 설정되어 기본 테이블의 RLS를 상속받습니다.

---

## 운영 테이블

### 12. `vibememory.job_locks`

동시 실행 방지를 위한 작업 잠금 테이블입니다.

```sql
CREATE TABLE vibememory.job_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL UNIQUE,        -- 작업 이름 (예: 'scan_project_123')
  claimed_at timestamptz NOT NULL DEFAULT now(),  -- 잠금 시작 시간
  expires_at timestamptz NOT NULL,      -- 잠금 만료 시간
  claimed_by text                       -- 잠금을 획득한 프로세스/워커 식별자
);
```

**인덱스:**
- `idx_job_locks_expires_at` ON `expires_at` WHERE `expires_at > now()`

**용도:**
- 동일한 작업의 중복 실행 방지
- 만료된 잠금 자동 정리

---

### 13. `vibememory.api_quota_tracking`

GitHub API 쿼터 추적 및 관리 테이블입니다.

```sql
CREATE TABLE vibememory.api_quota_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL UNIQUE,        -- API 엔드포인트 (예: 'repos')
  remaining integer NOT NULL,           -- 남은 쿼터
  reset_at timestamptz NOT NULL,        -- 쿼터 리셋 시간
  last_updated timestamptz NOT NULL DEFAULT now(),  -- 마지막 업데이트 시간
  UNIQUE(endpoint)
);
```

**용도:**
- GitHub API Rate Limit 관리
- 쿼터 소진 방지

---

### 14. `vibememory.project_phase_snapshots`

프로젝트 진행률 일별 스냅샷 테이블입니다. (선택적)

```sql
CREATE TABLE vibememory.project_phase_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),  -- 스냅샷 캡처 시간
  total_md integer NOT NULL DEFAULT 0,             -- 전체 .md 파일 수
  indexed_md integer NOT NULL DEFAULT 0,           -- 인덱싱된 .md 파일 수
  embedded_chunks integer NOT NULL DEFAULT 0,      -- 임베딩된 청크 수
  expected_chunks integer NOT NULL DEFAULT 0,      -- 예상 청크 수
  core_reviews_done integer NOT NULL DEFAULT 0,    -- 완료된 핵심 리뷰 수
  core_reviews_total integer NOT NULL DEFAULT 3,   -- 전체 핵심 리뷰 수 (idea, tech, patent)
  up_to_date_files integer NOT NULL DEFAULT 0      -- 최신 상태 파일 수
);
```

**인덱스:**
- `idx_project_phase_snapshots_project_id` ON `project_id`
- `idx_project_phase_snapshots_captured_at` ON `project_id, captured_at DESC`

**용도:**
- 프로젝트 진행률 추적
- 일별 진행률 히스토리 관리

---

## 관계도

```
vibememory.projects (1)
  ├── vibememory.repo_files (N) [project_type = 'github']
  │   └── vibememory.repo_file_chunks (N)
  │       └── vibememory.chat_message_citations (N)
  │
  ├── vibememory.idea_project_files (N) [project_type = 'idea']
  │   └── vibememory.idea_project_chunks (N)
  │
  ├── vibememory.chat_sessions (N)
  │   └── vibememory.chat_messages (N)
  │       └── vibememory.chat_message_citations (N)
  │
  ├── vibememory.project_screenshots (N)
  │   └── vibememory.screenshot_comments (N)
  │
  └── vibememory.project_analysis (1)
```

---

## 참고사항

1. **Soft Delete**: 일부 테이블(`project_screenshots`, `screenshot_comments`, `idea_project_files`)은 `deleted_at` 컬럼을 사용한 Soft Delete를 지원합니다.

2. **벡터 임베딩**: 모든 벡터는 OpenAI `text-embedding-3-small` 모델을 사용하며, 1536차원입니다.

3. **타임스탬프**: 모든 테이블은 `created_at`과 `updated_at`을 자동으로 관리합니다.

4. **CASCADE 삭제**: 프로젝트 삭제 시 관련된 모든 데이터가 CASCADE로 삭제됩니다.

---

**문서 버전**: 1.0  
**마지막 업데이트**: 2025-11-16

