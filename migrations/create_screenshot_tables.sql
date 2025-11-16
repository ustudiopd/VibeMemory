-- 스크린샷 갤러리 및 댓글 테이블 생성
-- 해결책.md 1장 참조

-- 1. 스크린샷 메타 테이블
CREATE TABLE IF NOT EXISTS vibememory.project_screenshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  owner_id         uuid NOT NULL,                             -- RLS 키 (프로젝트 소유자)
  storage_path     text NOT NULL,                             -- {project_id}/{screenshot_id}/{filename}
  file_name        text NOT NULL,
  file_size        bigint NOT NULL,
  mime_type        text NOT NULL CHECK (mime_type LIKE 'image/%'),
  width            int,                                       -- 선택: 클라에서 추출 or 서버에서 계산
  height           int,
  checksum_sha256  text,                                      -- 중복 방지/무결성 확인
  caption          text,
  alt_text         text,
  visibility       text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  position         double precision NOT NULL DEFAULT 1000,    -- 리오더 편의용 부동소수 포지션
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_project_screenshots_project_id_position 
  ON vibememory.project_screenshots (project_id, position);
CREATE INDEX IF NOT EXISTS idx_project_screenshots_project_id_created_at 
  ON vibememory.project_screenshots (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_screenshots_project_id_deleted_at 
  ON vibememory.project_screenshots (project_id, deleted_at) WHERE deleted_at IS NULL;

-- 2. 스크린샷 댓글 테이블
CREATE TABLE IF NOT EXISTS vibememory.screenshot_comments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screenshot_id    uuid NOT NULL REFERENCES vibememory.project_screenshots(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  author_id        uuid NOT NULL,                             -- 댓글 작성자
  content          text NOT NULL,                             -- 마크다운 텍스트(서버에서 sanitize)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_screenshot_comments_screenshot_id_created_at 
  ON vibememory.screenshot_comments (screenshot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_screenshot_comments_project_id_created_at 
  ON vibememory.screenshot_comments (project_id, created_at);

-- 3. RLS 정책
-- 주의: 현재 프로젝트는 시스템 사용자 패턴을 사용하므로, 
-- API에서는 supabaseAdmin을 사용하여 RLS를 우회합니다.
-- RLS 정책은 추가 보안 레이어로만 작동합니다.

ALTER TABLE vibememory.project_screenshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ps_select ON vibememory.project_screenshots;
DROP POLICY IF EXISTS ps_insert ON vibememory.project_screenshots;
DROP POLICY IF EXISTS ps_update ON vibememory.project_screenshots;
DROP POLICY IF EXISTS ps_delete ON vibememory.project_screenshots;

CREATE POLICY ps_select ON vibememory.project_screenshots
  FOR SELECT USING (owner_id = auth.uid() AND deleted_at IS NULL);
CREATE POLICY ps_insert ON vibememory.project_screenshots
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY ps_update ON vibememory.project_screenshots
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY ps_delete ON vibememory.project_screenshots
  FOR DELETE USING (owner_id = auth.uid());

ALTER TABLE vibememory.screenshot_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sc_select ON vibememory.screenshot_comments;
DROP POLICY IF EXISTS sc_insert ON vibememory.screenshot_comments;
DROP POLICY IF EXISTS sc_update ON vibememory.screenshot_comments;
DROP POLICY IF EXISTS sc_delete ON vibememory.screenshot_comments;

CREATE POLICY sc_select ON vibememory.screenshot_comments
  FOR SELECT USING (
    (author_id = auth.uid() OR EXISTS (
      SELECT 1 FROM vibememory.projects p 
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )) AND deleted_at IS NULL
  );
CREATE POLICY sc_insert ON vibememory.screenshot_comments
  FOR INSERT WITH CHECK (author_id = auth.uid());
CREATE POLICY sc_update ON vibememory.screenshot_comments
  FOR UPDATE USING (author_id = auth.uid());
CREATE POLICY sc_delete ON vibememory.screenshot_comments
  FOR DELETE USING (author_id = auth.uid());

-- 4. Storage RLS 정책 (storage.objects)
-- 주의: 현재 프로젝트는 시스템 사용자 패턴을 사용하므로,
-- Storage 업로드는 서버 사이드에서 supabaseAdmin으로 처리합니다.
-- Storage RLS 정책은 추가 보안 레이어로만 작동합니다.

DROP POLICY IF EXISTS storage_ps_insert ON storage.objects;
DROP POLICY IF EXISTS storage_ps_select ON storage.objects;
DROP POLICY IF EXISTS storage_ps_delete ON storage.objects;

CREATE POLICY storage_ps_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-screenshots'
    AND EXISTS (
      SELECT 1 FROM vibememory.projects p
      WHERE p.id::text = split_part(name, '/', 1)   -- 첫 세그먼트 = project_id
        AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY storage_ps_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-screenshots'
    AND EXISTS (
      SELECT 1 FROM vibememory.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY storage_ps_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-screenshots'
    AND EXISTS (
      SELECT 1 FROM vibememory.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND p.owner_id = auth.uid()
    )
  );

-- 5. public 스키마에 뷰 생성 (PostgREST 호환)
CREATE OR REPLACE VIEW public.project_screenshots AS
  SELECT * FROM vibememory.project_screenshots;

CREATE OR REPLACE VIEW public.screenshot_comments AS
  SELECT * FROM vibememory.screenshot_comments;

