-- 챗봇 세션 및 메시지 테이블 생성
-- 해결책.md 2장 참조

-- 2.1 세션/메시지 테이블
CREATE TABLE IF NOT EXISTS vibememory.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES vibememory.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  title text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vibememory.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES vibememory.chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system','user','assistant')),
  content text NOT NULL,
  model text,
  tokens_input int DEFAULT 0,
  tokens_output int DEFAULT 0,
  sources jsonb,
  error text,
  created_at timestamptz DEFAULT now()
);

-- 2.2 인덱스
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON vibememory.chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_id ON vibememory.chat_sessions (owner_id, project_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_project_id ON vibememory.chat_sessions (project_id, updated_at DESC);

-- 2.3 RLS 정책
ALTER TABLE vibememory.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vibememory.chat_messages ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제 (있다면)
DROP POLICY IF EXISTS chat_sessions_owner ON vibememory.chat_sessions;
DROP POLICY IF EXISTS chat_messages_owner ON vibememory.chat_messages;

-- 세션 RLS 정책
CREATE POLICY chat_sessions_owner ON vibememory.chat_sessions
  FOR ALL
  USING (owner_id = auth.uid());

-- 메시지 RLS 정책 (세션을 통해 owner_id 확인)
CREATE POLICY chat_messages_owner ON vibememory.chat_messages
  FOR ALL
  USING (
    session_id IN (
      SELECT id FROM vibememory.chat_sessions WHERE owner_id = auth.uid()
    )
  );

-- public 스키마에 뷰 생성 (PostgREST 호환)
CREATE OR REPLACE VIEW public.chat_sessions AS
SELECT * FROM vibememory.chat_sessions;

CREATE OR REPLACE VIEW public.chat_messages AS
SELECT * FROM vibememory.chat_messages;

-- 뷰에 대한 RLS는 기본 테이블의 RLS를 상속받음
ALTER VIEW public.chat_sessions SET (security_invoker = true);
ALTER VIEW public.chat_messages SET (security_invoker = true);

