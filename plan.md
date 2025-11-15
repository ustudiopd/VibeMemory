알겠습니다. "VibeMemory" 프로젝트명으로 확정하고, Cursor AI가 바로 실행할 수 있도록 **시나리오별 상세 동작**과 **AI 프롬프트 엔지니어링 모듈**을 포함한 **최종 v1.0 명세서**를 작성했습니다.

이 명세서는 `smpp-govhub`에서 검증된 `float8[]` 트릭, `job_lock`/`CLAIM`, RLS 우선 원칙, RRF 하이브리드 검색, SSE(POST) 스트리밍 등 프로덕션급 패턴을 모두 포함합니다.

-----

## 📖 프로젝트 명세서: VibeMemory v1.0 (최종 실행 계획)

### 1\. 최종 아키텍처 (요약)

  * **App**: Next.js 14+ (App Router) / API Routes
  * **DB/Vector**: Supabase (PostgreSQL + pgvector)
  * **LLM/Embedding**: OpenAI (생성: `gpt-4.1-mini`, 임베딩: `text-embedding-3-small` 1536차원)
  * **동기화**: GitHub Webhook(push) + Vercel Cron(야간 보정)
  * **스트리밍**: **SSE (POST)** 방식. 프론트엔드는 `fetchEventSource`로 수신하고, 서버는 `text/event-stream`으로 응답합니다. (GET 방식의 `EventSource` 사용 금지)
  * **운영 패턴**: `job_lock` 및 `CLAIM` RPC를 통한 동시성 제어, `api_quota_tracking`을 통한 쿼터 관리 및 지수 백오프, RLS 우선 보안 (모두 `smpp-govhub`에서 검증된 패턴).

-----

### 2\. 데이터 모델 (DB 스키마)

  * **스키마**: `vibememory` 스키마로 격리하여 운영합니다.
  
  * **핵심 테이블**:
  
      * **`vibememory.projects`** (가져온 리포지토리 관리)
          ```sql
          CREATE TABLE vibememory.projects (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            repo_owner TEXT NOT NULL,
            repo_name TEXT NOT NULL,
            repo_url TEXT NOT NULL UNIQUE,
            webhook_id BIGINT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          ```
          * **RLS**: `owner_id = auth.uid()` 정책을 최우선 적용합니다.
          * **인덱스**: `CREATE INDEX idx_projects_owner_id ON vibememory.projects(owner_id);`
      
      * **`vibememory.repo_files`** (파일 메타데이터)
          ```sql
          CREATE TABLE vibememory.repo_files (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            sha TEXT NOT NULL,
            size INTEGER NOT NULL,
            is_current BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(project_id, path, sha)
          );
          ```
          * **인덱스**: 
            - `CREATE INDEX idx_repo_files_project_id ON vibememory.repo_files(project_id);`
            - `CREATE INDEX idx_repo_files_path ON vibememory.repo_files(path);`
            - `CREATE INDEX idx_repo_files_is_current ON vibememory.repo_files(project_id, is_current) WHERE is_current = true;`
      
      * **`vibememory.repo_file_chunks`** (RAG DB)
          ```sql
          CREATE TABLE vibememory.repo_file_chunks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo_file_id UUID NOT NULL REFERENCES vibememory.repo_files(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
            embedding VECTOR(1536),
            embedding_version TEXT NOT NULL DEFAULT 'text-embedding-3-small',
            is_current BOOLEAN NOT NULL DEFAULT true,
            chunk_index INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          ```
          * **인덱스**: 
            - `CREATE INDEX idx_repo_file_chunks_fts ON vibememory.repo_file_chunks USING GIN(fts);`
            - `CREATE INDEX idx_repo_file_chunks_embedding ON vibememory.repo_file_chunks USING hnsw(embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);`
            - `CREATE INDEX idx_repo_file_chunks_repo_file_id ON vibememory.repo_file_chunks(repo_file_id);`
            - `CREATE INDEX idx_repo_file_chunks_is_current ON vibememory.repo_file_chunks(repo_file_id, is_current) WHERE is_current = true;`
      
      * **`vibememory.project_analysis`** (AI 분석 결과)
          ```sql
          CREATE TABLE vibememory.project_analysis (
            project_id UUID PRIMARY KEY REFERENCES vibememory.projects(id) ON DELETE CASCADE,
            idea_review TEXT,
            tech_review TEXT,
            patent_review TEXT,
            latest_release_note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          ```
  
  * **운영 테이블**:
  
      * **`vibememory.job_locks`** (동시 실행 방지)
          ```sql
          CREATE TABLE vibememory.job_locks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            job_name TEXT NOT NULL UNIQUE,
            claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL,
            claimed_by TEXT
          );
          ```
          * **인덱스**: `CREATE INDEX idx_job_locks_expires_at ON vibememory.job_locks(expires_at) WHERE expires_at > now();`
      
      * **`vibememory.api_quota_tracking`** (GitHub API 쿼터 관리)
          ```sql
          CREATE TABLE vibememory.api_quota_tracking (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            endpoint TEXT NOT NULL,
            remaining INTEGER NOT NULL,
            reset_at TIMESTAMPTZ NOT NULL,
            last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(endpoint)
          );
          ```
  
  * **진행률 캐시 (선택적)**:
  
      * **`vibememory.project_phase_snapshots`** (일별 진행률 스냅샷)
          ```sql
          CREATE TABLE vibememory.project_phase_snapshots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
            captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            total_md INTEGER NOT NULL DEFAULT 0,
            indexed_md INTEGER NOT NULL DEFAULT 0,
            embedded_chunks INTEGER NOT NULL DEFAULT 0,
            expected_chunks INTEGER NOT NULL DEFAULT 0,
            core_reviews_done INTEGER NOT NULL DEFAULT 0,
            core_reviews_total INTEGER NOT NULL DEFAULT 3,
            up_to_date_files INTEGER NOT NULL DEFAULT 0
          );
          ```
          * **인덱스**: 
            - `CREATE INDEX idx_project_phase_snapshots_project_id ON vibememory.project_phase_snapshots(project_id);`
            - `CREATE INDEX idx_project_phase_snapshots_captured_at ON vibememory.project_phase_snapshots(project_id, captured_at DESC);`
  
  * **RLS 정책 (Row Level Security)**:
      * 모든 테이블에 대해 `owner_id = auth.uid()` 기준으로 연쇄 격리 정책을 적용합니다.
      * 예시 (`projects` 테이블):
          ```sql
          ALTER TABLE vibememory.projects ENABLE ROW LEVEL SECURITY;
          CREATE POLICY "Users can only access their own projects"
            ON vibememory.projects
            FOR ALL
            USING (owner_id = auth.uid());
          ```
      * 하위 테이블(`repo_files`, `repo_file_chunks` 등)은 `project_id`를 통해 `projects.owner_id`와 JOIN하여 RLS를 적용합니다.

-----

### 3\. RAG 검색 전략 (RRF + float8[])

  * **RRF (하이브리드 검색)**: 검색 품질을 높이기 위해 키워드 검색(FTS `tsvector`)과 벡터 검색(pgvector `HNSW`)을 DB RPC 내에서 \*\*RRF(Reciprocal Rank Fusion)\*\*로 합산합니다.
      * `memory_bank/` 등 핵심 경로에 1.2배 가중치를 부여하는 전략을 `smpp-govhub`의 2-Source RAG 패턴처럼 적용합니다.
  * **`float8[]` 파라미터 트릭**: PostgREST API가 `vector` 타입을 JSON으로 직접 파싱하지 못하는 `smpp-govhub`의 문제를 회피하기 위해, RPC 함수는 파라미터를 `float8[]`로 받고 함수 내부에서 `::vector(1536)`로 캐스팅합니다.

-----

### 4\. 시나리오별 API 및 상세 동작

각 시나리오는 사용자가 VibeMemory를 사용하는 주요 기능 흐름을 나타냅니다.

#### S1/S2: 신규 프로젝트 '가져오기' (최초 등록) (P0)

  * **시나리오 설명**: 사용자가 VibeMemory에서 관리할 GitHub 리포지토리를 선택하여 시스템에 처음 등록하는 과정입니다.
  * `POST /api/projects/import` (Body: `{ repo_name, repo_owner }`)
  * **동작**:
    1.  **`CLAIM`**: `vibememory.job_locks`를 `CLAIM`하여 해당 리포지토리의 동시 임포트/인덱싱 작업을 방지합니다.
    2.  **DB 저장**: `vibememory.projects` 테이블에 `owner_id = auth.uid()`와 함께 리포지토리 정보를 저장합니다.
    3.  **Webhook 등록**: GitHub API로 Webhook을 생성하고 `webhook_id`를 `projects` 테이블에 저장합니다.
    4.  **최초 스캔 (S3) 트리거**: `S3/S4` (최초 스캔) 작업을 비동기(백그라운드)로 실행합니다.

#### S3/S4: 최초 스캔 및 AI 자동 리뷰 (초기 인덱싱) (P1, P3)

  * **시나리오 설명**: 시스템이 방금 가져온(S1/S2) 프로젝트의 모든 .md 파일을 읽어 RAG DB를 구축하고, 첫 번째 AI 자동 리뷰를 생성하는 초기 인덱싱 과정입니다.
  * **(내부 호출)** `lib/runInitialScan(projectId)`
  * **동작**:
    1.  **파일 탐색**: GitHub API로 리포지토리의 모든 `.md` 파일 트리(path, sha)를 수집합니다.
    2.  **RAG 인덱싱 (P1, P2)**: `.md` 파일 본문을 가져와 청킹 및 임베딩 후 `vibememory.repo_file_chunks`에 저장합니다. (`embedding_version` 명시)
    3.  **AI 리뷰 (P3)**: `projectbrief.md`, `techContext.md` 등 핵심 파일 내용을 \*\*(섹션 7)\*\*의 `모듈 1, 2, 3`에 전달하여 `vibememory.project_analysis` 테이블에 결과를 저장합니다.

#### S5: GitHub Push 자동 동기화 (실시간 업데이트) (P4, P5)

  * **시나리오 설명**: 사용자가 GitHub에 `push`할 때마다, VibeMemory가 변경 사항을 자동으로 감지하여 RAG DB, AI 리뷰, 진행률 지표를 최신 상태로 유지하는 과정입니다.
  * `POST /api/github/webhook`
  * **동작**:
    1.  **(보안)** `X-Hub-Signature-256` HMAC 서명을 **필수**로 검증합니다.
    2.  **`CLAIM`**: `job_lock` 및 `CLAIM` RPC를 사용하여 동일 리포지토리에 대한 동시 처리를 방지합니다.
    3.  **Payload 파싱**: `push` 페이로드의 `modified`, `added`, `removed`된 `.md` 파일 목록을 추출합니다.
    4.  **외과적 RAG 업데이트 (P4)**:
          * `modified`: 해당 `file_path`의 기존 청크(`repo_file_chunks.is_current = false`)를 비활성화(또는 삭제)합니다. 그 후, 최신 파일 본문을 GitHub API로 가져와 재-청킹/재-임베딩하여 `INSERT` 합니다 (좀비 데이터 제거).
          * `added`/`removed`: 각각 `INSERT` / `DELETE` (또는 비활성화) 합니다.
    5.  **AI 릴리즈 노트 (P5)**: 커밋 메시지들을 \*\*(섹션 7)\*\*의 `모듈 5`에 전달하여 `latest_release_note`를 업데이트합니다.
    6.  **AI 리뷰 갱신 (P3)**: `modified` 목록에 `projectbrief.md` 등 핵심 파일이 있으면 `S3/S4`의 AI 리뷰 모듈을 다시 트리거합니다.

#### S5.5: 야간 보정 및 스냅샷 생성 (Cron)

  * **시나리오 설명**: Webhook이 놓쳤을 수 있는 변경 사항을 보정하고, 시계열 트렌드 데이터를 생성하기 위해 하루 한 번 실행되는 시스템 작업입니다.
  * `GET /api/cron/sanity-check`
  * **동작**:
    1.  **`job_lock`**: `vibememory.job_locks`를 획득하여 동시 실행을 방지합니다.
    2.  **보정 (P4)**: GitHub API로 최신 트리의 `.md` 파일 목록/SHA와 DB(`repo_files`)를 비교하여 불일치(Webhook 누락)를 보정합니다.
    3.  **스냅샷 생성**: `get_project_progress` RPC를 호출하여 P1\~P5 지표를 계산하고 `vibememory.project_phase_snapshots` 테이블에 일일 스냅샷을 `INSERT`합니다.

#### S6: 신규 프로젝트 스캐폴딩 (자동 생성)

  * **시나리오 설명**: 사용자가 새 아이디어를 시작할 때, 버튼 클릭 한 번으로 표준 템플릿(`.cursorrules.md` 등)이 포함된 새 GitHub 리포지토리를 생성하는 과정입니다.
  * `POST /api/projects/create` (Body: `{ repo_name }`)
  * **동작**:
    1.  GitHub API로 새 리포지토리를 생성합니다.
    2.  로컬 템플릿(`.cursorrules.md`, `memory_bank/projectbrief.md` 등)을 읽어 GitHub API로 `push`합니다.
    3.  `S1/S2` 로직을 내부적으로 호출하여 임포트 및 Webhook 등록을 완료합니다.

#### S7: 듀얼 RAG 챗봇 (지식 검색) (P6)

  * **시나리오 설명**: 사용자가 '특정 프로젝트' 또는 '모든 프로젝트'를 대상으로 지식을 검색하고 AI의 답변을 받는 과정입니다.
  * `POST /api/chat` (Body: `{ message, projectId: null | string }`)
  * `POST /api/projects/:id/chat` (Body: `{ message }`)
  * **동작**:
    1.  **스트리밍 (POST)**: `fetchEventSource` (프론트엔드)를 통해 `POST` 요청을 수신합니다.
    2.  **RLS**: API는 `auth.uid()`를 기반으로 RLS가 적용된 Supabase 클라이언트를 사용합니다.
    3.  **RAG 검색**: `projectId` 유무에 따라 RAG 검색 범위를 분기합니다. \*\*(섹션 3)\*\*의 RRF 하이브리드 검색 RPC ( `float8[]` 입력 방식)를 호출합니다.
    4.  **AI 답변**: RAG 검색 결과를 \*\*(섹션 7)\*\*의 `모듈 6` 프롬프트에 주입하여 LLM 답변을 생성합니다.
    5.  **응답**: `text/event-stream` 형식으로 토큰을 실시간 스트리밍합니다.

-----

### 5\. Progress Analytics & Visualization 모듈 (SQL 기반)

"시스템이 해당 리포지토리를 얼마나 잘 처리 중인지"를 **SQL 집계(COUNT/RPC)로 측정**하여 100% 신뢰할 수 있는 지표를 제공합니다.

  * **5.1 Phase 정의**
      * **P0**: Import & Webhook (등록 및 검증 완료 여부)
      * **P1**: Initial Indexing (`indexed_md / total_md`)
      * **P2**: Chunk & Embedding (`embedded_chunks / expected_chunks`)
      * **P3**: AI Reviews (핵심 리뷰 `core_done / core_total`, 예: 3/3)
      * **P4**: Freshness (신선도, `up_to_date_files / total_md`)
      * **P5**: Release Notes (최근 N회 `push` 중 생성률)
  * **5.2 API**
      * `GET /api/projects/:id/progress`: 단일 프로젝트의 P0\~P5 지표 JSON 반환. (`get_project_progress` RPC 호출)
      * `GET /api/portfolio/progress`: 모든 프로젝트의 지표 합산/평균.
      * `GET /api/portfolio/progress/trends?window=30d`: `project_phase_snapshots` 테이블 기반의 시계열 데이터 반환.
  * **5.3 UI 컴포넌트 (Tailwind/Shadcn)**
      * `PhaseRingGrid`: P0\~P5 진행률을 보여주는 6개 도넛 차트.
      * `Funnel`: P1 → P2의 누수 시각화 (인덱싱 → 임베딩).
      * `Burndown`: 미처리 변경 파일(P4 신선도) 누적/소진 그래프.
      * `Freshness Heatmap`: 최근 30일 P4 신선도 캘린더 히트맵.
      * `Release Notes Sparkline`: 최근 P5 생성률 스파크라인.

-----

### 6\. SQL RPC 모듈 (핵심)

  * **`vibememory.hybrid_search_rrf`** (RAG 하이브리드 검색)
      ```sql
      CREATE OR REPLACE FUNCTION vibememory.hybrid_search_rrf(
        p_query_text TEXT,
        p_query_embedding float8[],
        p_project_id UUID DEFAULT NULL,
        p_limit INTEGER DEFAULT 10,
        p_memory_bank_weight NUMERIC DEFAULT 1.2
      )
      RETURNS TABLE (
        id UUID,
        content TEXT,
        file_path TEXT,
        project_id UUID,
        repo_file_id UUID,
        rank_score NUMERIC
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        v_query_vector vector(1536);
      BEGIN
        -- float8[]을 vector로 캐스팅
        v_query_vector := p_query_embedding::vector(1536);
        
        -- FTS 검색 결과와 Vector 검색 결과를 RRF로 병합
        RETURN QUERY
        WITH fts_results AS (
          SELECT 
            c.id,
            c.content,
            f.path AS file_path,
            f.project_id,
            c.repo_file_id,
            ts_rank(c.fts, plainto_tsquery('english', p_query_text)) AS fts_rank
          FROM vibememory.repo_file_chunks c
          JOIN vibememory.repo_files f ON c.repo_file_id = f.id
          WHERE c.is_current = true
            AND (p_project_id IS NULL OR f.project_id = p_project_id)
            AND c.fts @@ plainto_tsquery('english', p_query_text)
        ),
        vector_results AS (
          SELECT 
            c.id,
            c.content,
            f.path AS file_path,
            f.project_id,
            c.repo_file_id,
            1 - (c.embedding <=> v_query_vector) AS vector_score
          FROM vibememory.repo_file_chunks c
          JOIN vibememory.repo_files f ON c.repo_file_id = f.id
          WHERE c.is_current = true
            AND (p_project_id IS NULL OR f.project_id = p_project_id)
            AND c.embedding IS NOT NULL
          ORDER BY c.embedding <=> v_query_vector
          LIMIT p_limit * 2
        ),
        combined AS (
          SELECT 
            COALESCE(f.id, v.id) AS id,
            COALESCE(f.content, v.content) AS content,
            COALESCE(f.file_path, v.file_path) AS file_path,
            COALESCE(f.project_id, v.project_id) AS project_id,
            COALESCE(f.repo_file_id, v.repo_file_id) AS repo_file_id,
            CASE 
              WHEN f.file_path LIKE '%memory_bank%' THEN p_memory_bank_weight
              ELSE 1.0
            END * (
              1.0 / (60 + COALESCE(f.fts_rank, 0)) +
              1.0 / (60 + COALESCE(v.vector_score, 0))
            ) AS rank_score
          FROM fts_results f
          FULL OUTER JOIN vector_results v ON f.id = v.id
        )
        SELECT 
          combined.id,
          combined.content,
          combined.file_path,
          combined.project_id,
          combined.repo_file_id,
          combined.rank_score
        FROM combined
        ORDER BY combined.rank_score DESC
        LIMIT p_limit;
      END;
      $$;
      ```
      * **목적**: RAG 검색 수행 (섹션 3).
      * **핵심**: `query_embedding`을 `float8[]`로 받아 내부에서 `::vector(1536)`로 캐스팅합니다. FTS와 Vector 결과를 RRF로 병합합니다.
      * **가중치**: `memory_bank/` 경로의 파일에 `p_memory_bank_weight` (기본 1.2배) 가중치를 적용합니다.
  
  * **`vibememory.get_project_progress`** (진행률 지표 계산)
      ```sql
      CREATE OR REPLACE FUNCTION vibememory.get_project_progress(
        p_project_id UUID
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        v_total_md INTEGER;
        v_indexed_md INTEGER;
        v_embedded_chunks INTEGER;
        v_expected_chunks INTEGER;
        v_core_done INTEGER;
        v_core_total INTEGER := 3;
        v_up_to_date_files INTEGER;
        v_webhook_configured BOOLEAN;
        v_result JSONB;
      BEGIN
        -- P0: Webhook 설정 여부
        SELECT webhook_id IS NOT NULL INTO v_webhook_configured
        FROM vibememory.projects
        WHERE id = p_project_id;
        
        -- P1: 인덱싱 진행률 (total_md / indexed_md)
        SELECT 
          COUNT(*) FILTER (WHERE path LIKE '%.md'),
          COUNT(*) FILTER (WHERE path LIKE '%.md' AND is_current = true)
        INTO v_total_md, v_indexed_md
        FROM vibememory.repo_files
        WHERE project_id = p_project_id;
        
        -- P2: 임베딩 진행률
        SELECT COUNT(*) INTO v_embedded_chunks
        FROM vibememory.repo_file_chunks c
        JOIN vibememory.repo_files f ON c.repo_file_id = f.id
        WHERE f.project_id = p_project_id
          AND c.is_current = true
          AND c.embedding IS NOT NULL;
        
        -- expected_chunks는 indexed_md * 평균 청크 수 (예: 5)로 추정
        v_expected_chunks := v_indexed_md * 5;
        
        -- P3: AI 리뷰 완료율
        SELECT 
          (CASE WHEN idea_review IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN tech_review IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN patent_review IS NOT NULL THEN 1 ELSE 0 END)
        INTO v_core_done
        FROM vibememory.project_analysis
        WHERE project_id = p_project_id;
        
        -- P4: 신선도 (up_to_date_files / total_md)
        -- SHA 비교 로직으로 고도화 필요 (현재는 indexed_md로 근사)
        v_up_to_date_files := v_indexed_md;
        
        -- JSON 결과 생성
        v_result := jsonb_build_object(
          'P0', jsonb_build_object(
            'webhook_configured', v_webhook_configured
          ),
          'P1', jsonb_build_object(
            'total_md', v_total_md,
            'indexed_md', v_indexed_md,
            'progress', CASE WHEN v_total_md > 0 THEN v_indexed_md::NUMERIC / v_total_md ELSE 0 END
          ),
          'P2', jsonb_build_object(
            'embedded_chunks', v_embedded_chunks,
            'expected_chunks', v_expected_chunks,
            'progress', CASE WHEN v_expected_chunks > 0 THEN v_embedded_chunks::NUMERIC / v_expected_chunks ELSE 0 END
          ),
          'P3', jsonb_build_object(
            'core_done', v_core_done,
            'core_total', v_core_total,
            'progress', v_core_done::NUMERIC / v_core_total
          ),
          'P4', jsonb_build_object(
            'up_to_date_files', v_up_to_date_files,
            'total_md', v_total_md,
            'progress', CASE WHEN v_total_md > 0 THEN v_up_to_date_files::NUMERIC / v_total_md ELSE 0 END
          ),
          'P5', jsonb_build_object(
            'has_release_note', EXISTS (
              SELECT 1 FROM vibememory.project_analysis
              WHERE project_id = p_project_id
                AND latest_release_note IS NOT NULL
            )
          )
        );
        
        RETURN v_result;
      END;
      $$;
      ```
      * **목적**: 진행률 지표 계산 (섹션 5).
      * **핵심**: `repo_files`, `repo_file_chunks`, `project_analysis` 테이블을 `COUNT` 및 `JOIN`하여 P0\~P5 지표를 JSON으로 반환합니다.
  
  * **`vibememory.claim_job`** (동시성 제어)
      ```sql
      CREATE OR REPLACE FUNCTION vibememory.claim_job(
        p_job_name TEXT,
        p_duration INTERVAL DEFAULT '1 hour'
      )
      RETURNS BOOLEAN
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        v_claimed BOOLEAN := false;
      BEGIN
        -- 기존 만료된 잠금 정리
        DELETE FROM vibememory.job_locks
        WHERE job_name = p_job_name
          AND expires_at < now();
        
        -- 원자적으로 잠금 획득 시도
        INSERT INTO vibememory.job_locks (job_name, expires_at, claimed_by)
        VALUES (p_job_name, now() + p_duration, current_setting('app.current_user_id', true))
        ON CONFLICT (job_name) DO UPDATE
        SET 
          claimed_at = now(),
          expires_at = now() + p_duration,
          claimed_by = current_setting('app.current_user_id', true)
        WHERE job_locks.expires_at < now()
        RETURNING true INTO v_claimed;
        
        RETURN v_claimed;
      END;
      $$;
      ```
      * **목적**: 동시성 제어 (섹션 4).
      * **핵심**: `job_locks` 테이블을 원자적으로(`ON CONFLICT`) 확인하고 잠금을 획득합니다. 만료된 잠금은 자동으로 정리됩니다.

-----

### 7\. AI 프롬프트 엔지니어링 모듈 (`lib/analysisService.ts`)

이 모듈은 정성적 리뷰(P3, P5) 및 챗봇(P6) 응답 생성을 담당합니다.

#### 🤖 모듈 1: 아이디어 리뷰 (P3)

  * **역할**: 비즈니스 분석가 (BA)
  * **입력**: `projectbrief.md`, `productContext.md` 파일의 텍스트
  * **프롬프트**:
    ```
    제공된 'projectbrief.md'와 'productContext.md'를 분석하여 다음을 식별하십시오:
    1.  **핵심 문제 (Problem)**: 이 프로젝트가 해결하려는 핵심 문제는 무엇입니까?
    2.  **최종 목표 (Goal)**: 이 문제가 해결되었을 때의 기대 효과는 무엇입니까?
    3.  **타겟 사용자 (User)**: 이 시스템의 주 사용자는 누구입니까?
    ```

#### 🤖 모듈 2: 기술 리뷰 (P3)

  * **역할**: 수석 아키텍트
  * **입력**: `techContext.md`, `systemPatterns.md`, `progress.md`, `activeContext.md` 파일의 텍스트
  * **프롬프트**:
    ```
    제공된 기술 문서를 종합하여, 이 프로젝트에서 다른 프로젝트가 참고할 만한 핵심 기술 패턴 3가지를 추출하십시오. 단순한 '기술 스택' 나열이 아닌, 구체적인 '문제/해결' 쌍 또는 '독창적인 설계 패턴'에 집중하십시오.

    예시 ('smpp-govhub' 기준):
    - **PPSSrch API 연동**: 서버 측 필터링(bidNtceNm)을 통한 G2B API 쿼터 절약
    - **pgvector float8[] 버그 해결**: vector 타입 대신 float8[] 배열로 파라미터를 전달하여 PostgREST API 문제를 해결
    - **CloudConvert import/base64**: HWP 변환 실패 문제를 'import/upload' 대신 'import/base64' 방식으로 해결
    ```

#### 🤖 모듈 3: 특허 분석 (P3)

  * **역할**: 소프트웨어 특허 분석가
  * **입력**: 모듈 1과 2의 분석 결과, `productContext.md`
  * **프롬프트**:
    ```
    이 프로젝트의 '비즈니스 아이디어'와 '독창적인 기술 구현'이 결합된 지점을 찾아 특허화할 수 있는 발명 아이디어 2가지를 제안하십시오.
    (예: "다중 소스 가중치를 적용한 입찰 공고 분석 챗봇 시스템")
    ```

#### 🤖 모듈 5: 릴리즈 노트 생성 (P5)

  * **역할**: 테크니컬 라이터
  * **입력**: GitHub Webhook `push` 이벤트의 커밋 메시지 목록 (JSON 배열)
  * **프롬프트**:
    ```
    다음은 이번 'push'에 포함된 커밋 메시지 목록입니다. 이 변경 사항을 요약하는 간결하고 명확한 '릴리즈 노트' 한 문단을 작성하십시오.

    [커밋 메시지 목록]
    ```

#### 🤖 모듈 6: RAG 챗봇 (P6)

  * **역할**: AI 비서
  * **입력**: Vercel AI SDK가 제공하는 컨텍스트(청크)와 사용자 질문
  * **프롬프트**:
    ```
    당신은 제공된 '컨텍스트'만을 기반으로 답변하는 AI 비서입니다.
    - 컨텍스트에 답변이 없으면 "제공된 정보에 해당 내용이 없습니다."라고 말하십시오.
    - 절대 당신의 사전 지식을 사용하지 마십시오.
    - 제공된 '컨텍스트'를 인용하여 답변하십시오.

    컨텍스트:
    ---
    {context}
    ---
    질문: {question}
    답변:
    ```

-----

### 8\. 보안, 운영 및 테스트 계획

  * **보안 (RLS 우선)**: `vibememory` 스키마로 격리하고, `projects.owner_id = auth.uid()` 기준으로 모든 하위 테이블(files, chunks)을 **연쇄 격리**합니다. Webhook은 `X-Hub-Signature-256` HMAC 서명 검증이 **필수**입니다.
  * **운영 (Cron/쿼터)**: Cron 작업은 `/api/cron/*` 규약으로 표준화하고 `job_lock`을 적용합니다. GitHub API 쿼터는 `api_quota_tracking` 테이블과 지수 백오프로 관리합니다.
  * **테스트 계획**:
      * **좀비 데이터**: `modified`된 파일 `push` → 재-인덱싱 후 챗봇 질의 시, 수정 전의 오래된 청크가 답변에 섞이지 않는지 검증.
      * **RAG RPC**: `float8[]` 파라미터로 RRF 검색이 정상 작동하는지 (벡터 직수신 실패 케이스 회피 검증).
      * **SSE(POST)**: `fetchEventSource`로 챗봇 토큰 스트림이 정상 수신/중단/복구되는지 검증.
      * **동시성**: Import, Webhook, Cron이 **동시에 트리거**될 때 `job_lock` 및 `CLAIM` RPC가 중복 실행을 방지하는지 검증.
      * **RLS**: 사용자 A가 사용자 B의 프로젝트 ID로 API 호출 시 데이터가 차단되는지 검증.

-----

### 9\. 📦 "VibeMemory v1.0 Final" — 즉시 적용 체크리스트

#### Phase 1: 데이터베이스 인프라 (필수)
  * [ ] **(필수)** Supabase에서 `vibememory` 스키마 생성
  * [ ] **(필수)** pgvector 확장 프로그램 활성화 (`CREATE EXTENSION IF NOT EXISTS vector;`)
  * [ ] **(필수)** 모든 핵심 테이블 생성 (`projects`, `repo_files`, `repo_file_chunks`, `project_analysis`)
  * [ ] **(필수)** 운영 테이블 생성 (`job_locks`, `api_quota_tracking`)
  * [ ] **(필수)** 진행률 캐시 테이블 생성 (`project_phase_snapshots`)
  * [ ] **(필수)** 모든 인덱스 생성 (GIN, HNSW, B-tree 인덱스)
  * [ ] **(필수)** RLS 정책 적용 (모든 테이블에 `owner_id = auth.uid()` 기준 연쇄 격리)

#### Phase 2: RPC 함수 구현 (필수)
  * [ ] **(필수)** `vibememory.claim_job` RPC 함수 생성 (동시성 제어)
  * [ ] **(필수)** `vibememory.get_project_progress` RPC 함수 생성 (진행률 계산)
  * [ ] **(필수)** `vibememory.hybrid_search_rrf` RPC 함수 생성: `float8[]` 입력 → 내부 `::vector(1536)` 캐스팅

#### Phase 3: API 엔드포인트 구현 (필수)
  * [ ] **(필수)** GitHub OAuth 인증 구현 (NextAuth.js)
  * [ ] **(필수)** `POST /api/projects/import` 구현 (S1/S2)
  * [ ] **(필수)** `lib/runInitialScan` 함수 구현 (S3/S4)
  * [ ] **(필수)** `POST /api/github/webhook` 구현 (S5) - HMAC 서명 검증 필수
  * [ ] **(필수)** `POST /api/chat` 및 `POST /api/projects/:id/chat` 구현 (S7) - **`fetchEventSource(POST)`** 기반 SSE 스트리밍

#### Phase 4: 운영 및 최적화 (권장)
  * [ ] **(권장)** `GET /api/cron/sanity-check` 구현 (S5.5) - 야간 보정 Cron
  * [ ] **(권장)** `POST /api/projects/create` 구현 (S6) - 프로젝트 스캐폴딩
  * [ ] **(권장)** `GET /api/projects/:id/progress` 구현 - 진행률 API
  * [ ] **(권장)** `GET /api/portfolio/progress` 구현 - 포트폴리오 전체 진행률
  * [ ] **(권장)** GitHub API 쿼터 관리 로직 구현 (`api_quota_tracking` 활용)

#### Phase 5: 프론트엔드 컴포넌트 (권장)
  * [ ] **(권장)** `PhaseRingGrid` 컴포넌트 구현 (P0~P5 도넛 차트)
  * [ ] **(권장)** `Funnel` 컴포넌트 구현 (P1 → P2 누수 시각화)
  * [ ] **(권장)** `Burndown` 컴포넌트 구현 (P4 신선도 그래프)
  * [ ] **(권장)** `Freshness Heatmap` 컴포넌트 구현 (30일 캘린더 히트맵)
  * [ ] **(권장)** RAG 챗봇 UI 구현 (`fetchEventSource` 기반 스트리밍)