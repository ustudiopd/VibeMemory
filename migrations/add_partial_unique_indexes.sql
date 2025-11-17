-- 부분 유니크 인덱스 추가
-- 해결책_검토_보고서.md 참조
-- GitHub 프로젝트와 아이디어 프로젝트의 중복 방지

-- 1. 기존 중복 데이터 확인 (마이그레이션 전 확인용)
-- 실행 후 중복이 있으면 먼저 정리 필요
DO $$
DECLARE
  github_duplicates integer;
  idea_duplicates integer;
BEGIN
  -- GitHub 프로젝트 중복 확인
  SELECT COUNT(*) INTO github_duplicates
  FROM (
    SELECT owner_id, repo_owner, repo_name, COUNT(*)
    FROM vibememory.projects
    WHERE project_type = 'github'
      AND repo_owner IS NOT NULL
      AND repo_name IS NOT NULL
    GROUP BY owner_id, repo_owner, repo_name
    HAVING COUNT(*) > 1
  ) duplicates;
  
  -- 아이디어 프로젝트 중복 확인
  SELECT COUNT(*) INTO idea_duplicates
  FROM (
    SELECT owner_id, project_name, COUNT(*)
    FROM vibememory.projects
    WHERE project_type = 'idea'
      AND project_name IS NOT NULL
    GROUP BY owner_id, project_name
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF github_duplicates > 0 THEN
    RAISE WARNING 'GitHub 프로젝트 중복 발견: %건. 마이그레이션 전 정리 필요.', github_duplicates;
  END IF;
  
  IF idea_duplicates > 0 THEN
    RAISE WARNING '아이디어 프로젝트 중복 발견: %건. 마이그레이션 전 정리 필요.', idea_duplicates;
  END IF;
END $$;

-- 2. GitHub 프로젝트 중복 방지 인덱스
-- 같은 사용자가 같은 GitHub 리포지토리를 여러 번 가져오는 것 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_github
  ON vibememory.projects (owner_id, repo_owner, repo_name)
  WHERE project_type = 'github'
    AND repo_owner IS NOT NULL
    AND repo_name IS NOT NULL;

-- 3. 아이디어 프로젝트 중복 방지 인덱스
-- 같은 사용자가 같은 이름의 아이디어 프로젝트를 여러 개 만드는 것 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_idea
  ON vibememory.projects (owner_id, project_name)
  WHERE project_type = 'idea'
    AND project_name IS NOT NULL;

-- 4. 인덱스 생성 확인
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'vibememory' 
    AND tablename = 'projects' 
    AND indexname = 'uq_projects_github'
  ) THEN
    RAISE NOTICE '✅ GitHub 프로젝트 중복 방지 인덱스 생성 완료';
  ELSE
    RAISE WARNING '❌ GitHub 프로젝트 중복 방지 인덱스 생성 실패';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'vibememory' 
    AND tablename = 'projects' 
    AND indexname = 'uq_projects_idea'
  ) THEN
    RAISE NOTICE '✅ 아이디어 프로젝트 중복 방지 인덱스 생성 완료';
  ELSE
    RAISE WARNING '❌ 아이디어 프로젝트 중복 방지 인덱스 생성 실패';
  END IF;
END $$;


