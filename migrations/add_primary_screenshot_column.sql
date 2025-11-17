-- 대표 이미지 지정 기능 추가
-- project_screenshots 테이블에 is_primary 컬럼 추가

-- 1. is_primary 컬럼 추가
ALTER TABLE vibememory.project_screenshots
ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- 2. 기존 데이터는 모두 false로 설정 (이미 DEFAULT로 처리됨)
-- 명시적으로 업데이트 (선택사항)
-- UPDATE vibememory.project_screenshots SET is_primary = false WHERE is_primary IS NULL;

-- 3. 프로젝트당 하나의 대표 이미지만 허용하는 부분 유니크 인덱스
-- is_primary = true인 경우에만 프로젝트당 하나만 허용
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_screenshots_primary
  ON vibememory.project_screenshots (project_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- 4. 대표 이미지 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_project_screenshots_project_id_primary
  ON vibememory.project_screenshots (project_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

-- 5. public 스키마 뷰 업데이트 (PostgREST 호환)
DROP VIEW IF EXISTS public.project_screenshots;
CREATE OR REPLACE VIEW public.project_screenshots AS
  SELECT * FROM vibememory.project_screenshots;

