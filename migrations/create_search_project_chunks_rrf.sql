-- 프로젝트 범위 RRF 검색 RPC 함수
-- 해결책.md 3장 참조

CREATE OR REPLACE FUNCTION vibememory.search_project_chunks_rrf(
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
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT c.id AS chunk_id, f.path AS file_path, c.content, c.embedding, c.fts
    FROM vibememory.repo_file_chunks c
    JOIN vibememory.repo_files f ON f.id = c.repo_file_id
    WHERE f.project_id = p_project_id AND c.is_current = true
  ),
  fts_results AS (
    SELECT chunk_id, file_path, content,
           ts_rank(fts, plainto_tsquery('simple', p_query_text)) AS rank
    FROM base
    WHERE fts @@ plainto_tsquery('simple', p_query_text)
    ORDER BY rank DESC
    LIMIT p_limit
  ),
  vec_results AS (
    SELECT chunk_id, file_path, content,
           1 - (embedding <=> (p_query_vec::vector(1536))) AS sim
    FROM base
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> (p_query_vec::vector(1536))
    LIMIT p_limit
  )
  SELECT
    COALESCE(f.chunk_id, v.chunk_id) AS chunk_id,
    COALESCE(f.file_path, v.file_path) AS file_path,
    COALESCE(f.content, v.content) AS content,
    COALESCE(f.rank, 0)::real AS fts_rank,
    COALESCE(v.sim, 0)::real AS vector_similarity,
    (1.0 / (60 + COALESCE(f.rank, 0)) + 1.0 / (60 + COALESCE(v.sim, 0)))::real AS rrf_score
  FROM fts_results f
  FULL OUTER JOIN vec_results v USING (chunk_id)
  ORDER BY rrf_score DESC
  LIMIT p_limit;
END $$;

-- public 스키마에 래퍼 함수 생성
CREATE OR REPLACE FUNCTION public.search_project_chunks_rrf(
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
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM vibememory.search_project_chunks_rrf(
    p_project_id,
    p_query_text,
    p_query_vec,
    p_limit
  );
END $$;

