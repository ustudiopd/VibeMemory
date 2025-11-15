# Citations 테이블 전환 구현 계획

**작성일**: 2025-01-15  
**목표**: jsonb 방식에서 Citations 테이블 방식으로 전환하여 출처 클릭 시 청크로 이동 기능 구현

---

## 📋 전체 개요

### 목표
- `chat_message_citations` 테이블 생성 및 RLS 설정
- 메시지 저장 시 Citations 테이블에 출처 저장
- 메시지 조회 시 Citations 조회
- 출처 클릭 시 해당 청크 내용 조회 및 표시 기능

### 예상 작업 시간
- **Phase 1**: DB 마이그레이션 (30분)
- **Phase 2**: API 수정 (1시간)
- **Phase 3**: 프론트엔드 수정 (1.5시간)
- **Phase 4**: 테스트 및 검증 (30분)

**총 예상 시간**: 3.5시간

---

## Phase 1: 데이터베이스 마이그레이션

### 1.1 Citations 테이블 생성

**파일**: `migrations/create_chat_message_citations_table.sql`

```sql
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
```

### 1.2 기존 데이터 마이그레이션 (선택)

**파일**: `migrations/migrate_sources_to_citations.sql`

```sql
-- 기존 sources jsonb 데이터를 Citations 테이블로 마이그레이션
-- 주의: 이 마이그레이션은 선택사항입니다. 기존 데이터가 없으면 실행하지 않아도 됩니다.

INSERT INTO vibememory.chat_message_citations (message_id, project_id, file_path, chunk_id, score)
SELECT 
  cm.id AS message_id,
  cs.project_id,
  (source->>'file_path')::text AS file_path,
  (source->>'chunk_id')::uuid AS chunk_id,
  (source->>'score')::real AS score
FROM vibememory.chat_messages cm
JOIN vibememory.chat_sessions cs ON cs.id = cm.session_id
CROSS JOIN LATERAL jsonb_array_elements(cm.sources) AS source
WHERE cm.sources IS NOT NULL 
  AND jsonb_typeof(cm.sources) = 'array'
  AND cm.role = 'assistant';
```

**주의사항**:
- 기존 데이터가 많지 않다면 마이그레이션 생략 가능
- 새 메시지부터 Citations 테이블 사용
- 기존 `sources jsonb` 필드는 유지 (하위 호환성)

---

## Phase 2: API 수정

### 2.1 메시지 저장 API 수정

**파일**: `app/api/projects/[id]/chat/route.ts`

**변경 사항**:
1. 메시지 저장 시 `sources jsonb` 대신 Citations 테이블에 저장
2. 각 citation을 개별 레코드로 삽입

**수정 위치**: 255-291줄

**변경 전**:
```typescript
await supabaseAdmin.from('chat_messages').insert({
  session_id: session.id,
  role: 'assistant',
  content: fullContent,
  model: MODEL,
  tokens_input: tokensInput,
  tokens_output: tokensOutput,
  sources: sources,  // jsonb로 저장
});
```

**변경 후**:
```typescript
// Assistant 메시지 저장
const { data: assistantMessage, error: messageError } = await supabaseAdmin
  .from('chat_messages')
  .insert({
    session_id: session.id,
    role: 'assistant',
    content: fullContent,
    model: MODEL,
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    // sources 필드는 제거하거나 null로 설정
  })
  .select()
  .single();

if (assistantMessage && sources && sources.length > 0) {
  // Citations 테이블에 저장
  const citations = sources.map((source: any) => ({
    message_id: assistantMessage.id,
    project_id: projectId,
    file_path: source.file_path,
    chunk_id: source.chunk_id || null,
    score: source.score || null,
  }));

  await supabaseAdmin
    .from('chat_message_citations')
    .insert(citations);
}
```

### 2.2 메시지 조회 API 수정

**파일**: `app/api/projects/[id]/chat/sessions/[sessionId]/messages/route.ts`

**변경 사항**:
1. 메시지 조회 시 Citations도 함께 조회
2. `sources` 필드 대신 `citations` 배열 반환

**수정 위치**: 43-55줄

**변경 전**:
```typescript
let query = supabaseAdmin
  .from('chat_messages')
  .select('id, role, content, model, tokens_input, tokens_output, sources, error, created_at')
  .eq('session_id', sessionId)
  .order('created_at', { ascending: true })
  .limit(limit);
```

**변경 후**:
```typescript
// 메시지 조회
let query = supabaseAdmin
  .from('chat_messages')
  .select(`
    id, 
    role, 
    content, 
    model, 
    tokens_input, 
    tokens_output, 
    error, 
    created_at,
    chat_message_citations (
      id,
      file_path,
      chunk_id,
      score
    )
  `)
  .eq('session_id', sessionId)
  .order('created_at', { ascending: true })
  .limit(limit);

// ... (커서 처리)

// 응답 형식 변환
const messagesWithCitations = (messages || []).map((msg: any) => ({
  ...msg,
  sources: (msg.chat_message_citations || []).map((citation: any) => ({
    file_path: citation.file_path,
    chunk_id: citation.chunk_id,
    score: citation.score,
  })),
  chat_message_citations: undefined, // 제거
}));

return NextResponse.json({
  messages: messagesWithCitations,
  nextCursor,
});
```

### 2.3 청크 조회 API 추가 (신규)

**파일**: `app/api/projects/[id]/chunks/[chunkId]/route.ts` (신규 생성)

**목적**: 출처 클릭 시 해당 청크 내용 조회

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * GET /api/projects/[id]/chunks/[chunkId]
 * 특정 청크 내용 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chunkId: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId, chunkId } = await params;

    // 프로젝트 소유 확인
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 청크 조회 (프로젝트 소유 확인 포함)
    const { data: chunk, error: chunkError } = await supabaseAdmin
      .from('repo_file_chunks')
      .select(`
        id,
        content,
        chunk_index,
        repo_files!inner (
          id,
          path,
          project_id
        )
      `)
      .eq('id', chunkId)
      .eq('repo_files.project_id', projectId)
      .eq('is_current', true)
      .single();

    if (chunkError || !chunk) {
      return NextResponse.json(
        { error: '청크를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: chunk.id,
      content: chunk.content,
      chunk_index: chunk.chunk_index,
      file_path: (chunk.repo_files as any).path,
    });
  } catch (error) {
    console.error('[CHUNK] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
```

---

## Phase 3: 프론트엔드 수정

### 3.1 ChatInterface 컴포넌트 수정

**파일**: `components/ChatInterface.tsx`

**변경 사항**:
1. 출처 클릭 핸들러 추가
2. 청크 내용 조회 및 표시 기능
3. 청크 미리보기 모달/패널 추가

**추가할 기능**:

```typescript
// 출처 클릭 핸들러
const handleCitationClick = async (chunkId: string, filePath: string) => {
  if (!projectId || !chunkId) return;

  try {
    const response = await fetch(`/api/projects/${projectId}/chunks/${chunkId}`);
    if (response.ok) {
      const data = await response.json();
      // 청크 내용 표시 (모달 또는 사이드 패널)
      setSelectedChunk({
        id: data.id,
        content: data.content,
        file_path: data.file_path,
        chunk_index: data.chunk_index,
      });
      setShowChunkPreview(true);
    }
  } catch (error) {
    console.error('[ChatInterface] Error fetching chunk:', error);
  }
};

// 출처 표시 부분 수정
{message.role === 'assistant' && message.sources && message.sources.length > 0 && (
  <div className="mt-2 ml-4">
    <div className="text-xs text-gray-500 mb-1">참고 출처:</div>
    <div className="flex flex-wrap gap-2">
      {message.sources.map((source, idx) => (
        <button
          key={idx}
          onClick={() => source.chunk_id && handleCitationClick(source.chunk_id, source.file_path)}
          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors cursor-pointer"
          title={`유사도: ${source.score?.toFixed(3) || 'N/A'}\n클릭하여 청크 내용 보기`}
          disabled={!source.chunk_id}
        >
          {source.file_path.split('/').pop()}
        </button>
      ))}
    </div>
  </div>
)}
```

### 3.2 청크 미리보기 컴포넌트 추가

**파일**: `components/ChunkPreview.tsx` (신규 생성)

```typescript
'use client';

import { X } from 'lucide-react';

interface ChunkPreviewProps {
  chunk: {
    id: string;
    content: string;
    file_path: string;
    chunk_index: number;
  } | null;
  onClose: () => void;
}

export default function ChunkPreview({ chunk, onClose }: ChunkPreviewProps) {
  if (!chunk) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">청크 내용</h3>
            <p className="text-sm text-gray-500 mt-1">
              {chunk.file_path} (청크 #{chunk.chunk_index})
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded">
            {chunk.content}
          </pre>
        </div>
      </div>
    </div>
  );
}
```

**ChatInterface에 통합**:
```typescript
import ChunkPreview from './ChunkPreview';

// state 추가
const [selectedChunk, setSelectedChunk] = useState<{
  id: string;
  content: string;
  file_path: string;
  chunk_index: number;
} | null>(null);
const [showChunkPreview, setShowChunkPreview] = useState(false);

// 컴포넌트 렌더링 부분에 추가
return (
  <div className="flex flex-col h-full bg-white w-full">
    {/* ... 기존 코드 ... */}
    
    {/* 청크 미리보기 */}
    {showChunkPreview && selectedChunk && (
      <ChunkPreview
        chunk={selectedChunk}
        onClose={() => {
          setShowChunkPreview(false);
          setSelectedChunk(null);
        }}
      />
    )}
  </div>
);
```

---

## Phase 4: 테스트 및 검증

### 4.1 단위 테스트

1. **DB 마이그레이션 테스트**
   - Citations 테이블 생성 확인
   - RLS 정책 작동 확인
   - 인덱스 생성 확인

2. **API 테스트**
   - 메시지 저장 시 Citations 저장 확인
   - 메시지 조회 시 Citations 포함 확인
   - 청크 조회 API 작동 확인

### 4.2 통합 테스트

1. **전체 플로우 테스트**
   - 메시지 전송 → Citations 저장 → 메시지 조회 → 출처 표시
   - 출처 클릭 → 청크 조회 → 미리보기 표시

2. **에러 처리 테스트**
   - 존재하지 않는 chunk_id 처리
   - 권한 없는 청크 접근 처리

### 4.3 E2E 테스트 시나리오

1. **기본 시나리오**
   - 프로젝트 챗봇에서 질문 입력
   - 응답 받기
   - 출처 클릭하여 청크 내용 확인

2. **세션 로드 시나리오**
   - 기존 세션 선택
   - 메시지 히스토리 로드
   - 출처 클릭하여 청크 내용 확인

---

## 체크리스트

### Phase 1: DB 마이그레이션
- [ ] `create_chat_message_citations_table.sql` 생성
- [ ] 마이그레이션 실행
- [ ] 테이블 생성 확인
- [ ] RLS 정책 확인
- [ ] 인덱스 확인
- [ ] (선택) 기존 데이터 마이그레이션

### Phase 2: API 수정
- [ ] `app/api/projects/[id]/chat/route.ts` 수정
  - [ ] 메시지 저장 시 Citations 테이블에 저장
  - [ ] `sources jsonb` 제거 또는 null 처리
- [ ] `app/api/projects/[id]/chat/sessions/[sessionId]/messages/route.ts` 수정
  - [ ] Citations 조회 추가
  - [ ] 응답 형식 변환
- [ ] `app/api/projects/[id]/chunks/[chunkId]/route.ts` 생성
  - [ ] 청크 조회 API 구현
  - [ ] 프로젝트 소유 확인
  - [ ] 에러 처리

### Phase 3: 프론트엔드 수정
- [ ] `components/ChatInterface.tsx` 수정
  - [ ] 출처 클릭 핸들러 추가
  - [ ] 청크 미리보기 state 추가
  - [ ] 출처 버튼 수정 (클릭 가능하도록)
- [ ] `components/ChunkPreview.tsx` 생성
  - [ ] 청크 미리보기 UI 구현
  - [ ] 닫기 기능

### Phase 4: 테스트
- [ ] 단위 테스트
- [ ] 통합 테스트
- [ ] E2E 테스트
- [ ] 에러 처리 테스트

---

## 주의사항

### 1. 하위 호환성
- 기존 `sources jsonb` 필드는 유지 (기존 데이터 호환)
- 새 메시지는 Citations 테이블 사용
- 메시지 조회 시 두 방식 모두 지원 (점진적 마이그레이션)

### 2. 성능 고려
- Citations 조회 시 JOIN 사용 (인덱스로 최적화)
- 청크 조회는 별도 API로 분리 (필요 시에만 호출)

### 3. 에러 처리
- `chunk_id`가 없는 경우 처리
- 청크가 삭제된 경우 처리 (`ON DELETE SET NULL`)
- 권한 없는 청크 접근 방지

### 4. UX 개선
- 출처 클릭 시 로딩 상태 표시
- 청크 미리보기 닫기 버튼
- 청크 내용 하이라이트 (선택적)

---

## 참고 파일

- 설계 문서: `해결책.md` (2.2장)
- 기존 마이그레이션: `migrations/create_chat_tables.sql`
- 기존 API: `app/api/projects/[id]/chat/route.ts`
- 기존 컴포넌트: `components/ChatInterface.tsx`

---

## 다음 단계

Citations 테이블 전환 완료 후:
1. 세션 관리 UI 구현 (SessionSidebar)
2. 세션 제목 자동 생성 기능
3. 출처별 통계 분석 기능 (선택적)

