-- Storage 버킷 생성 마이그레이션
-- Supabase Storage 버킷은 storage.buckets 테이블에 INSERT하여 생성합니다.

-- 1. repo-files 버킷 (리포지토리 파일용)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'repo-files',
  'repo-files',
  false,
  10485760, -- 10MB
  ARRAY['text/markdown', 'text/plain']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- 2. project-screenshots 버킷 (스크린샷용)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-screenshots',
  'project-screenshots',
  false,
  10485760, -- 10MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- 3. idea-project-files 버킷 (아이디어 프로젝트 파일용)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'idea-project-files',
  'idea-project-files',
  false,
  10485760, -- 10MB
  ARRAY['text/markdown', 'text/plain']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- 버킷 생성 확인
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('repo-files', 'project-screenshots', 'idea-project-files')
ORDER BY id;

