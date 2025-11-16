-- 챗봇 메시지 출처(Citations) 테이블 생성
-- 해결책.md 2.2장 참조

-- Citations 테이블
CREATE TABLE IF NOT EXISTS vibememory.chat_message_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES vibememory.chat_messages(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  chunk_id uuid REFERENCES vibememory.repo_file_chunks(id) ON DELETE SET NULL,
  score real,  -- 유사도/가중치 (RRF score)
  created_at timestamptz DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_chat_message_citations_message_id 
  ON vibememory.chat_message_citations (message_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_citations_chunk_id 
  ON vibememory.chat_message_citations (chunk_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_citations_project_id 
  ON vibememory.chat_message_citations (project_id);

-- RLS 정책
ALTER TABLE vibememory.chat_message_citations ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제 (있다면)
DROP POLICY IF EXISTS chat_message_citations_owner ON vibememory.chat_message_citations;

-- Citations RLS 정책 (메시지를 통해 owner_id 확인)
CREATE POLICY chat_message_citations_owner ON vibememory.chat_message_citations
  FOR ALL
  USING (
    message_id IN (
      SELECT id FROM vibememory.chat_messages 
      WHERE session_id IN (
        SELECT id FROM vibememory.chat_sessions WHERE owner_id = auth.uid()
      )
    )
  );

-- public 스키마에 뷰 생성 (PostgREST 호환)
CREATE OR REPLACE VIEW public.chat_message_citations AS
SELECT * FROM vibememory.chat_message_citations;

ALTER VIEW public.chat_message_citations SET (security_invoker = true);

