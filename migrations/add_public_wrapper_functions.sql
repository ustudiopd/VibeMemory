-- public 스키마에 vibememory RPC 함수들을 래핑하는 함수들 생성
-- Supabase JS 클라이언트는 public 스키마만 찾을 수 있음

-- hybrid_search_rrf 래퍼 함수
CREATE OR REPLACE FUNCTION public.hybrid_search_rrf(
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
BEGIN
  RETURN QUERY
  SELECT * FROM vibememory.hybrid_search_rrf(
    p_query_text,
    p_query_embedding,
    p_project_id,
    p_limit,
    p_memory_bank_weight
  );
END;
$$;

-- claim_job 래퍼 함수
CREATE OR REPLACE FUNCTION public.claim_job(
  p_job_name TEXT,
  p_duration INTERVAL DEFAULT '1 hour'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN vibememory.claim_job(p_job_name, p_duration);
END;
$$;

-- get_project_progress 래퍼 함수 (필요한 경우)
CREATE OR REPLACE FUNCTION public.get_project_progress(
  p_project_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN vibememory.get_project_progress(p_project_id);
END;
$$;

