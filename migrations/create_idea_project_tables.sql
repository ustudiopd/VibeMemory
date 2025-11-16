-- 프로젝트 만들기 및 아이디어 인큐베이팅 기능 구현
-- 해결책.md 1장 참조

-- 1. 프로젝트 타입 ENUM 생성 (IF NOT EXISTS는 CREATE TYPE에서 지원하지 않음)
DO $$ BEGIN
  CREATE TYPE vibememory.project_type AS ENUM ('github', 'idea');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. projects 테이블에 project_type 컬럼 추가
ALTER TABLE vibememory.projects 
ADD COLUMN IF NOT EXISTS project_type vibememory.project_type NOT NULL DEFAULT 'github';

-- 3. GitHub 관련 필드를 nullable로 변경
ALTER TABLE vibememory.projects 
ALTER COLUMN repo_owner DROP NOT NULL,
ALTER COLUMN repo_name DROP NOT NULL,
ALTER COLUMN repo_url DROP NOT NULL;

-- 4. 기존 UNIQUE 제약 조건 제거 (아이디어 프로젝트는 repo_url이 없을 수 있음)
ALTER TABLE vibememory.projects 
DROP CONSTRAINT IF EXISTS projects_repo_url_key;

-- 5. project_type이 'github'일 때만 repo_url이 필수
ALTER TABLE vibememory.projects 
DROP CONSTRAINT IF EXISTS projects_github_requires_repo_url;

ALTER TABLE vibememory.projects 
ADD CONSTRAINT projects_github_requires_repo_url 
CHECK (
  (project_type = 'github' AND repo_url IS NOT NULL) OR 
  (project_type = 'idea')
);

-- 6. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_projects_project_type 
ON vibememory.projects(project_type);

CREATE INDEX IF NOT EXISTS idx_projects_owner_type 
ON vibememory.projects(owner_id, project_type);

-- 7. 아이디어 프로젝트용 파일 메타데이터 테이블
CREATE TABLE IF NOT EXISTS vibememory.idea_project_files (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES vibememory.projects(id) ON DELETE CASCADE NOT NULL,
  owner_id uuid NOT NULL,                             -- RLS 키 (프로젝트 소유자)
  file_name TEXT NOT NULL,
  file_type TEXT,
  storage_path TEXT NOT NULL,
  file_size bigint,
  mime_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- 8. 아이디어 파일의 RAG용 청크 테이블
CREATE TABLE IF NOT EXISTS vibememory.idea_project_chunks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES vibememory.projects(id) ON DELETE CASCADE NOT NULL,
  file_id uuid REFERENCES vibememory.idea_project_files(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding VECTOR(1536),                             -- text-embedding-3-small
  embedding_version TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  token_count INT,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 9. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_idea_project_files_project_id 
ON vibememory.idea_project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_idea_project_files_project_id_deleted_at 
ON vibememory.idea_project_files(project_id, deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_idea_project_chunks_project_id 
ON vibememory.idea_project_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_idea_project_chunks_file_id 
ON vibememory.idea_project_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_idea_project_chunks_fts 
ON vibememory.idea_project_chunks USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_idea_project_chunks_embedding 
ON vibememory.idea_project_chunks 
USING hnsw(embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64)
WHERE embedding IS NOT NULL;

-- 10. RLS 정책
ALTER TABLE vibememory.idea_project_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ipf_select ON vibememory.idea_project_files;
DROP POLICY IF EXISTS ipf_insert ON vibememory.idea_project_files;
DROP POLICY IF EXISTS ipf_update ON vibememory.idea_project_files;
DROP POLICY IF EXISTS ipf_delete ON vibememory.idea_project_files;

CREATE POLICY ipf_select ON vibememory.idea_project_files
  FOR SELECT USING (
    owner_id = auth.uid() AND deleted_at IS NULL
  );
CREATE POLICY ipf_insert ON vibememory.idea_project_files
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY ipf_update ON vibememory.idea_project_files
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY ipf_delete ON vibememory.idea_project_files
  FOR DELETE USING (owner_id = auth.uid());

ALTER TABLE vibememory.idea_project_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ipc_select ON vibememory.idea_project_chunks;
DROP POLICY IF EXISTS ipc_insert ON vibememory.idea_project_chunks;
DROP POLICY IF EXISTS ipc_update ON vibememory.idea_project_chunks;
DROP POLICY IF EXISTS ipc_delete ON vibememory.idea_project_chunks;

CREATE POLICY ipc_select ON vibememory.idea_project_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vibememory.projects p 
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );
CREATE POLICY ipc_insert ON vibememory.idea_project_chunks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vibememory.projects p 
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );
CREATE POLICY ipc_update ON vibememory.idea_project_chunks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM vibememory.projects p 
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );
CREATE POLICY ipc_delete ON vibememory.idea_project_chunks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM vibememory.projects p 
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

-- 11. public 스키마에 뷰 생성 (PostgREST 호환)
CREATE OR REPLACE VIEW public.idea_project_files AS
  SELECT * FROM vibememory.idea_project_files;

CREATE OR REPLACE VIEW public.idea_project_chunks AS
  SELECT * FROM vibememory.idea_project_chunks;

