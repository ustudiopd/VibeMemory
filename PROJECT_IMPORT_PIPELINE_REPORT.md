# 프로젝트 임포트 파이프라인 구현 리포트

## 📋 목차
1. [개요](#개요)
2. [현재 구현 상태](#현재-구현-상태)
3. [단계별 상세 분석](#단계별-상세-분석)
4. [발견된 문제점](#발견된-문제점)
5. [구현해야 할 사항](#구현해야-할-사항)
6. [우선순위별 작업 계획](#우선순위별-작업-계획)

---

## 개요

VibeMemory 프로젝트 임포트 파이프라인은 GitHub 리포지토리를 가져와 지식 자산으로 변환하는 핵심 프로세스입니다. 이 리포트는 현재 구현 상태를 분석하고, 개선이 필요한 부분을 식별합니다.

### 파이프라인 단계
1. **P1: 인덱싱** - MD 파일 목록 수집 및 메타데이터 저장
2. **P2: 임베딩** - 파일 내용 청킹 및 벡터 임베딩 생성
3. **P3: AI 리뷰** - 핵심 파일 분석 및 자동 리뷰 생성

---

## 현재 구현 상태

### ✅ 완료된 기능

#### 1. 프로젝트 임포트 엔드포인트
- **파일**: `app/api/projects/import/route.ts`
- **기능**:
  - GitHub 리포지토리 정보 수신
  - 중복 임포트 방지 (기존 프로젝트 확인)
  - 동시성 제어 (`claim_job` RPC 사용)
  - Webhook 생성
  - 프로젝트 레코드 생성
  - 비동기 초기 스캔 트리거

#### 2. 초기 스캔 로직
- **파일**: `lib/runInitialScan.ts`
- **기능**:
  - GitHub API를 통한 MD 파일 트리 수집
  - 파일별 순차 처리
  - 파일 메타데이터 저장 (`repo_files` 테이블)
  - 청킹 및 임베딩 시도
  - AI 분석 호출

#### 3. RAG 처리 로직
- **파일**: `lib/rag.ts`
- **기능**:
  - 텍스트 청킹 (1000자, 200자 오버랩)
  - OpenAI Embeddings API 호출
  - 벡터 임베딩 생성 (1536차원)

#### 4. AI 분석 서비스
- **파일**: `lib/analysisService.ts`
- **기능**:
  - 핵심 파일 수집 (projectbrief.md, techContext.md 등)
  - 아이디어 리뷰 생성
  - 기술 리뷰 생성
  - 특허 분석 생성
  - 결과 저장 (`project_analysis` 테이블)

### ⚠️ 부분 구현 / 문제 있음

#### 1. 임베딩 삽입 (P2)
- **상태**: ❌ 실패
- **문제**: Vector 타입을 Supabase JS 클라이언트로 직접 삽입 시 타입 변환 실패
- **현재 코드**: RPC 함수 `insert_repo_file_chunks` 사용 시도 중
- **실제 결과**: 0개 청크 저장됨

#### 2. 에러 핸들링
- **상태**: ⚠️ 부족
- **문제**: 
  - 비동기 실행으로 인한 에러 추적 어려움
  - 사용자에게 진행 상태 피드백 없음
  - 실패한 작업에 대한 재시도 메커니즘 없음

#### 3. 진행 상태 추적
- **상태**: ⚠️ 부분 구현
- **문제**:
  - 실시간 진행률 업데이트 없음
  - 단계별 완료 상태 추적 부족
  - 사용자 UI에 진행 상태 표시 없음

---

## 단계별 상세 분석

### P1: 인덱싱 (Indexing)

#### 현재 구현
```typescript
// lib/runInitialScan.ts:26-47
const { data: repoFile, error: fileError } = await supabaseAdmin
  .from('repo_files')
  .upsert({
    project_id: projectId,
    path: item.path,
    sha: item.sha,
    size: content.length,
    is_current: true,
  }, {
    onConflict: 'project_id,path,sha',
  })
  .select()
  .single();
```

#### 상태
- ✅ **정상 작동**: 4개 MD 파일이 성공적으로 저장됨
- ✅ **중복 처리**: `upsert`로 중복 방지
- ✅ **메타데이터**: SHA, 크기 정보 저장

#### 개선 필요 사항
- ⚠️ **에러 복구**: 파일 저장 실패 시 재시도 로직
- ⚠️ **진행률 표시**: 인덱싱 진행률 UI 업데이트

---

### P2: 임베딩 (Embedding)

#### 현재 구현
```typescript
// lib/runInitialScan.ts:56-91
const chunks = chunkText(content, item.path);
const embeddings = await embedChunks(chunks);

const chunksToInsert = chunks.map((chunk, index) => ({
  repo_file_id: repoFile.id,
  content: chunk.content,
  embedding: embeddings[index],
  embedding_version: 'text-embedding-3-small',
  is_current: true,
  chunk_index: index,
}));

// RPC 함수 사용 시도
const { error: chunksError } = await supabaseAdmin.rpc('insert_repo_file_chunks', {
  p_chunks: chunksToInsert,
});
```

#### 상태
- ❌ **실패**: 0개 청크 저장됨
- ❌ **원인**: Vector 타입 변환 문제
- ⚠️ **Fallback**: 직접 삽입 시도하지만 여전히 실패

#### 문제 분석

1. **Vector 타입 처리**
   - Supabase JS 클라이언트는 `vector` 타입을 직접 지원하지 않음
   - RPC 함수에서 JSONB → float8[] → vector 변환 필요
   - 현재 RPC 함수의 변환 로직에 문제 있음

2. **RPC 함수 문제**
   ```sql
   -- 현재 RPC 함수 (문제 있음)
   CREATE OR REPLACE FUNCTION public.insert_repo_file_chunks(p_chunks JSONB)
   ```
   - JSONB 배열에서 vector 변환 로직 불완전
   - 1536차원 벡터 검증 부족

3. **에러 처리**
   - RPC 실패 시 fallback 시도하지만 여전히 실패
   - 에러 로그만 남기고 사용자에게 알림 없음

#### 개선 필요 사항
- 🔴 **긴급**: Vector 타입 삽입 로직 수정
- 🔴 **긴급**: RPC 함수 벡터 변환 로직 개선
- 🟡 **중요**: 배치 삽입으로 성능 개선
- 🟡 **중요**: 임베딩 API 호출 실패 시 재시도

---

### P3: AI 리뷰 (AI Review)

#### 현재 구현
```typescript
// lib/runInitialScan.ts:98-99
await analyzeProject(projectId, accessToken, repoOwner, repoName);
```

```typescript
// lib/analysisService.ts:11-78
export async function analyzeProject(...) {
  // 1. 핵심 파일 수집
  // 2. 아이디어 리뷰 생성
  // 3. 기술 리뷰 생성
  // 4. 특허 분석 생성
  // 5. 결과 저장
}
```

#### 상태
- ⚠️ **미실행**: 임베딩 실패로 인해 실행되지 않음
- ✅ **로직 완성**: 코드는 완전히 구현됨
- ⚠️ **의존성**: P2 완료 후에만 실행 가능

#### 문제 분석

1. **순차 의존성**
   - `runInitialScan`에서 모든 파일 처리 후 AI 분석 실행
   - 임베딩 실패 시 AI 분석도 실행되지 않음
   - 독립적으로 실행 가능해야 함

2. **에러 처리**
   - AI 분석 실패 시 전체 프로세스 실패로 처리
   - 부분 실패 허용 필요 (일부 리뷰만 생성되어도 저장)

3. **프롬프트 최적화**
   - 현재 프롬프트가 간단함
   - 더 구체적인 지시사항 필요
   - 컨텍스트 윈도우 최적화 필요

#### 개선 필요 사항
- 🟡 **중요**: AI 분석을 독립적으로 실행 가능하도록 분리
- 🟡 **중요**: 부분 실패 허용 (일부 리뷰만 생성되어도 저장)
- 🟢 **개선**: 프롬프트 엔지니어링 개선
- 🟢 **개선**: 토큰 사용량 최적화

---

## 발견된 문제점

### 🔴 긴급 (Critical)

1. **Vector 타입 삽입 실패**
   - **영향**: P2 단계 완전 실패
   - **원인**: Supabase JS 클라이언트의 vector 타입 미지원
   - **해결**: RPC 함수를 통한 타입 변환 또는 직접 SQL 사용

2. **에러 추적 불가**
   - **영향**: 문제 진단 어려움
   - **원인**: 비동기 실행 + 콘솔 로그만 사용
   - **해결**: 구조화된 로깅 및 에러 추적 시스템

### 🟡 중요 (High)

3. **진행 상태 피드백 없음**
   - **영향**: 사용자가 진행 상황을 알 수 없음
   - **원인**: 실시간 업데이트 메커니즘 없음
   - **해결**: WebSocket 또는 Server-Sent Events 사용

4. **재시도 메커니즘 없음**
   - **영향**: 일시적 실패 시 수동 재실행 필요
   - **원인**: 재시도 로직 미구현
   - **해결**: 지수 백오프 재시도 구현

5. **배치 처리 부족**
   - **영향**: 대용량 파일 처리 시 성능 저하
   - **원인**: 순차 처리만 사용
   - **해결**: 배치 처리 및 병렬 처리 도입

### 🟢 개선 (Medium)

6. **로깅 부족**
   - 상세한 진행 로그 없음
   - 에러 컨텍스트 부족
   - 성능 메트릭 수집 없음

7. **테스트 부족**
   - 단위 테스트 없음
   - 통합 테스트 없음
   - E2E 테스트 없음

---

## 구현해야 할 사항

### 1. Vector 타입 삽입 수정 (긴급)

#### 옵션 A: RPC 함수 개선 (권장)
```sql
-- 개선된 RPC 함수
CREATE OR REPLACE FUNCTION public.insert_repo_file_chunks(
  p_chunks JSONB
)
RETURNS TABLE (inserted_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_chunk JSONB;
  v_embedding_array float8[];
  v_inserted_count INTEGER := 0;
BEGIN
  FOR v_chunk IN SELECT * FROM jsonb_array_elements(p_chunks)
  LOOP
    -- JSON 배열을 float8 배열로 변환
    SELECT array_agg(value::float8 ORDER BY ordinality)
    INTO v_embedding_array
    FROM jsonb_array_elements_text(v_chunk->'embedding')
    WITH ORDINALITY;
    
    -- 차원 검증
    IF array_length(v_embedding_array, 1) != 1536 THEN
      RAISE EXCEPTION 'Expected 1536 dimensions, got %', array_length(v_embedding_array, 1);
    END IF;
    
    -- 삽입
    INSERT INTO vibememory.repo_file_chunks (
      repo_file_id,
      content,
      embedding,
      embedding_version,
      is_current,
      chunk_index
    ) VALUES (
      (v_chunk->>'repo_file_id')::uuid,
      v_chunk->>'content',
      v_embedding_array::vector(1536),
      COALESCE(v_chunk->>'embedding_version', 'text-embedding-3-small'),
      COALESCE((v_chunk->>'is_current')::boolean, true),
      (v_chunk->>'chunk_index')::integer
    );
    
    v_inserted_count := v_inserted_count + 1;
  END LOOP;
  
  RETURN QUERY SELECT v_inserted_count;
END;
$$;
```

#### 옵션 B: 직접 SQL 사용
```typescript
// lib/runInitialScan.ts
// Supabase SQL 직접 실행
const { error } = await supabaseAdmin.rpc('exec_sql', {
  query: `
    INSERT INTO vibememory.repo_file_chunks (...)
    VALUES ...
  `
});
```

### 2. 진행 상태 추적 시스템

#### 데이터베이스 스키마
```sql
-- 진행 상태 추적 테이블
CREATE TABLE vibememory.scan_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES vibememory.projects(id),
  phase TEXT NOT NULL, -- 'indexing', 'embedding', 'analysis'
  status TEXT NOT NULL, -- 'pending', 'running', 'completed', 'failed'
  current_item INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### API 엔드포인트
```typescript
// app/api/projects/[id]/scan-status/route.ts
export async function GET(request: NextRequest, { params }) {
  const { id: projectId } = await params;
  
  const { data: progress } = await supabaseAdmin
    .from('scan_progress')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  return NextResponse.json({ progress });
}
```

#### 프론트엔드 업데이트
```typescript
// app/dashboard/projects/[id]/page.tsx
useEffect(() => {
  const interval = setInterval(async () => {
    const response = await fetch(`/api/projects/${projectId}/scan-status`);
    const { progress } = await response.json();
    setScanProgress(progress);
  }, 2000); // 2초마다 업데이트
  
  return () => clearInterval(interval);
}, [projectId]);
```

### 3. 재시도 메커니즘

```typescript
// lib/utils/retry.ts
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}
```

```typescript
// lib/runInitialScan.ts에서 사용
const embeddings = await retryWithBackoff(
  () => embedChunks(chunks),
  3,
  1000
);
```

### 4. 배치 처리 개선

```typescript
// lib/runInitialScan.ts
// 파일을 배치로 처리
const BATCH_SIZE = 5;

for (let i = 0; i < tree.length; i += BATCH_SIZE) {
  const batch = tree.slice(i, i + BATCH_SIZE);
  
  await Promise.all(
    batch.map(item => processFile(item, projectId, accessToken, repoOwner, repoName))
  );
  
  // 진행 상태 업데이트
  await updateProgress(projectId, 'indexing', i + batch.length, tree.length);
}
```

### 5. 에러 추적 시스템

```typescript
// lib/utils/errorTracking.ts
export async function logError(
  projectId: string,
  phase: string,
  error: Error,
  context?: Record<string, any>
) {
  await supabaseAdmin
    .from('scan_errors')
    .insert({
      project_id: projectId,
      phase,
      error_message: error.message,
      error_stack: error.stack,
      context: context || {},
      occurred_at: new Date().toISOString(),
    });
}
```

### 6. 수동 재스캔 API

```typescript
// app/api/projects/[id]/rescan/route.ts
export async function POST(request: NextRequest, { params }) {
  const { id: projectId } = await params;
  
  // 프로젝트 정보 조회
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();
  
  // 재스캔 실행
  runInitialScan(
    projectId,
    systemUser.githubAccessToken,
    project.repo_owner,
    project.repo_name
  ).catch(error => {
    logError(projectId, 'rescan', error);
  });
  
  return NextResponse.json({ success: true });
}
```

---

## 우선순위별 작업 계획

### Phase 1: 긴급 수정 (1-2일)

1. ✅ **Vector 타입 삽입 수정**
   - RPC 함수 벡터 변환 로직 개선
   - 테스트 및 검증
   - 배포

2. ✅ **에러 로깅 개선**
   - 구조화된 에러 로깅 구현
   - 에러 추적 테이블 생성
   - 로그 수집 시스템 구축

### Phase 2: 중요 기능 (3-5일)

3. ✅ **진행 상태 추적**
   - 진행 상태 테이블 생성
   - API 엔드포인트 구현
   - 프론트엔드 UI 업데이트

4. ✅ **재시도 메커니즘**
   - 재시도 유틸리티 구현
   - 각 단계에 재시도 적용
   - 테스트

5. ✅ **수동 재스캔 기능**
   - 재스캔 API 구현
   - UI 버튼 추가
   - 테스트

### Phase 3: 성능 개선 (5-7일)

6. ✅ **배치 처리**
   - 배치 처리 로직 구현
   - 병렬 처리 도입
   - 성능 테스트

7. ✅ **최적화**
   - 임베딩 API 호출 최적화
   - 데이터베이스 쿼리 최적화
   - 캐싱 전략 도입

### Phase 4: 품질 향상 (7-10일)

8. ✅ **테스트**
   - 단위 테스트 작성
   - 통합 테스트 작성
   - E2E 테스트 작성

9. ✅ **모니터링**
   - 성능 메트릭 수집
   - 알림 시스템 구축
   - 대시보드 생성

---

## 결론

현재 프로젝트 임포트 파이프라인은 기본 구조는 완성되었으나, **P2 (임베딩) 단계에서 치명적인 문제**가 발생하고 있습니다. 이를 해결하기 위해서는:

1. **즉시**: Vector 타입 삽입 로직 수정
2. **단기**: 진행 상태 추적 및 에러 핸들링 개선
3. **중기**: 성능 최적화 및 배치 처리
4. **장기**: 테스트 및 모니터링 시스템 구축

이 리포트를 기반으로 단계별로 개선 작업을 진행하면, 안정적이고 사용자 친화적인 프로젝트 임포트 파이프라인을 구축할 수 있습니다.

---

**작성일**: 2025-11-15  
**작성자**: AI Assistant  
**버전**: 1.0



