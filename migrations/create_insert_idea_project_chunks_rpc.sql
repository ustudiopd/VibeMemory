-- 아이디어 프로젝트 청크 삽입 RPC 함수
-- 벡터 타입 변환을 위해 필요

CREATE OR REPLACE FUNCTION vibememory.insert_idea_project_chunks(
  p_chunks jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  chunk_item jsonb;
  chunk_embedding vector(1536);
  embedding_array float8[];
BEGIN
  FOR chunk_item IN SELECT * FROM jsonb_array_elements(p_chunks)
  LOOP
    -- 벡터 변환: jsonb array -> float8[] -> vector(1536)
    IF chunk_item->'embedding' IS NOT NULL AND chunk_item->'embedding' != 'null'::jsonb THEN
      -- jsonb array를 float8[]로 변환
      SELECT ARRAY(SELECT jsonb_array_elements_text(chunk_item->'embedding')::float8) INTO embedding_array;
      chunk_embedding := embedding_array::vector(1536);
    ELSE
      chunk_embedding := NULL;
    END IF;

    INSERT INTO vibememory.idea_project_chunks (
      project_id,
      file_id,
      content,
      embedding,
      embedding_version,
      chunk_index
    ) VALUES (
      (chunk_item->>'project_id')::uuid,
      (chunk_item->>'file_id')::uuid,
      chunk_item->>'content',
      chunk_embedding,
      COALESCE(chunk_item->>'embedding_version', 'text-embedding-3-small'),
      COALESCE((chunk_item->>'chunk_index')::integer, 0)
    );
  END LOOP;
END $$;

-- public 스키마에 래퍼 함수 생성
CREATE OR REPLACE FUNCTION public.insert_idea_project_chunks(
  p_chunks jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM vibememory.insert_idea_project_chunks(p_chunks);
END $$;

