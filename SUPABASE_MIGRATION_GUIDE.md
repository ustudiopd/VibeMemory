# Supabase 통합 마이그레이션 가이드

> **작성일**: 2025-01-XX  
> **목적**: 여러 내부 프로그램을 하나의 Supabase 프로젝트로 통합  
> **대상 프로젝트**: xiygbsaewuqocaxoxeqn (uslab)

---

## 📋 목차

1. [현재 상황 분석](#현재-상황-분석)
2. [스키마 설계 원칙](#스키마-설계-원칙)
3. [마이그레이션 전략](#마이그레이션-전략)
4. [단계별 마이그레이션 절차](#단계별-마이그레이션-절차)
5. [코드 수정 가이드](#코드-수정-가이드)
6. [테스트 및 검증](#테스트-및-검증)
7. [롤백 계획](#롤백-계획)
8. [체크리스트](#체크리스트)

---

## 현재 상황 분석

### Supabase 프로젝트 정보

- **프로젝트 ID**: `xiygbsaewuqocaxoxeqn`
- **프로젝트 이름**: `uslab`
- **URL**: `https://xiygbsaewuqocaxoxeqn.supabase.co`
- **리전**: `ap-northeast-2` (서울)
- **PostgreSQL 버전**: `17.6.1.044`
- **상태**: `ACTIVE_HEALTHY`

### 현재 스키마 구조

```
Supabase 프로젝트 (xiygbsaewuqocaxoxeqn)
│
├── hdd 스키마 (HDD 관리 시스템)
│   ├── physical_disks (11 rows)
│   ├── volumes (1 row)
│   ├── projects
│   ├── migration_logs
│   ├── comments
│   └── volume_events
│
└── vibememory 스키마 (VibeMemory 프로젝트)
    ├── projects (GitHub/Idea 프로젝트)
    ├── repo_files, repo_file_chunks
    ├── chat_sessions, chat_messages
    ├── idea_project_files, idea_project_chunks
    ├── project_screenshots, screenshot_comments
    └── ... (총 26개 테이블)
```

### 공통 스키마

- `public`: PostgREST 호환성을 위한 뷰 (모든 스키마에서 사용)
- `auth`: Supabase 인증 시스템
- `storage`: Supabase Storage
- `extensions`: PostgreSQL 확장 (pgvector 등)

---

## 스키마 설계 원칙

### 1. 스키마 격리 원칙

각 프로젝트는 **독립적인 스키마**를 사용합니다:

- ✅ **권장**: `{project_name}` 스키마 (예: `hdd`, `vibememory`)
- ❌ **비권장**: `public` 스키마에 직접 테이블 생성

**이유:**
- 프로젝트 간 테이블 이름 충돌 방지
- 명확한 책임 분리
- 향후 프로젝트 분리 용이

### 2. Public 스키마 뷰 패턴 (필수)

**⚠️ 중요**: PostgREST는 기본적으로 특정 스키마만 노출합니다. 현재 허용된 스키마는 `public`과 `hdd`만입니다.

**PostgREST 제약 사항:**
- PostgREST는 `public` 스키마와 명시적으로 설정된 스키마만 노출
- 다른 스키마(예: `vibememory`)에 직접 접근 시 `PGRST106` 에러 발생
- 에러 메시지: "The schema must be one of the following: public, hdd"

**해결책: Public 뷰를 통한 접근 (필수)**

Supabase JS 클라이언트 호환성과 PostgREST 제약을 해결하기 위해 `public` 스키마에 뷰를 생성합니다:

```sql
-- 예시: vibememory.projects → public.projects
CREATE OR REPLACE VIEW public.projects AS
SELECT * FROM vibememory.projects;

ALTER VIEW public.projects SET (security_invoker = true);
```

**주의사항:**
- ⚠️ **Public 뷰는 필수입니다**: PostgREST 제약으로 인해 실제 테이블 스키마에 직접 접근 불가
- 뷰 이름이 충돌할 경우 접두사 사용 (예: `public.vibememory_projects`)
- 코드에서는 기본 스키마를 `public`으로 설정하고 뷰를 통해 접근

### 3. RLS (Row Level Security) 정책

모든 테이블에 RLS를 활성화하고 적절한 정책을 설정합니다:

```sql
ALTER TABLE {schema}.{table} ENABLE ROW LEVEL SECURITY;

CREATE POLICY {policy_name} ON {schema}.{table}
  FOR ALL
  USING (owner_id = auth.uid());
```

### 4. 네이밍 컨벤션

- **스키마 이름**: 소문자, 언더스코어 없음 (예: `hdd`, `vibememory`)
- **테이블 이름**: 소문자, 언더스코어 사용 (예: `project_screenshots`)
- **컬럼 이름**: 소문자, 언더스코어 사용 (예: `created_at`)
- **인덱스 이름**: `idx_{table}_{columns}` (예: `idx_projects_owner_id`)
- **RPC 함수**: `{schema}.{function_name}` (예: `vibememory.hybrid_search_rrf`)

---

## 마이그레이션 전략

### 전략 1: 스키마별 완전 격리 (권장)

각 프로젝트를 독립 스키마로 마이그레이션:

```
기존 프로젝트 (별도 Supabase)
  └── public 스키마의 모든 테이블
      ↓
통합 Supabase 프로젝트
  └── {project_name} 스키마
      └── 모든 테이블 마이그레이션
```

**장점:**
- 프로젝트 간 완전한 격리
- 테이블 이름 충돌 없음
- 향후 분리 용이

**단점:**
- 코드 수정 필요 (스키마 명시)
- Public 뷰 생성 필요

### 전략 2: Public 뷰를 통한 호환성 유지

기존 코드 수정 최소화를 위해 `public` 스키마에 뷰 생성:

```sql
-- 기존 코드가 public.projects를 사용하는 경우
CREATE OR REPLACE VIEW public.projects AS
SELECT * FROM {new_schema}.projects;
```

**장점:**
- 기존 코드 수정 최소화
- 점진적 마이그레이션 가능

**단점:**
- 뷰 이름 충돌 가능성
- 성능 오버헤드 (미미함)

---

## 단계별 마이그레이션 절차

### Phase 0: 사전 준비

#### 0.1 현재 상태 백업

```bash
# Supabase CLI를 사용한 백업
supabase db dump -f backup_$(date +%Y%m%d_%H%M%S).sql

# 또는 pg_dump 직접 사용
pg_dump -h db.xiygbsaewuqocaxoxeqn.supabase.co \
  -U postgres \
  -d postgres \
  -f backup_$(date +%Y%m%d_%H%M%S).sql
```

#### 0.2 마이그레이션 계획 수립

- [ ] 마이그레이션할 프로젝트 목록 작성
- [ ] 각 프로젝트의 스키마 이름 결정
- [ ] 테이블 충돌 검사
- [ ] 데이터 볼륨 확인
- [ ] 다운타임 허용 범위 결정

#### 0.3 테스트 환경 준비

- [ ] Supabase 로컬 개발 환경 설정 (선택사항)
- [ ] 마이그레이션 스크립트 테스트

---

### Phase 1: 스키마 생성 및 기본 설정

#### 1.1 새 스키마 생성

```sql
-- 마이그레이션할 프로젝트의 스키마 생성
CREATE SCHEMA IF NOT EXISTS {project_name};

-- 스키마 소유자 설정 (필요한 경우)
ALTER SCHEMA {project_name} OWNER TO postgres;

-- 스키마 검색 경로 확인
SHOW search_path;
```

#### 1.2 확장 활성화 (필요한 경우)

```sql
-- pgvector 확장 (벡터 검색이 필요한 경우)
CREATE EXTENSION IF NOT EXISTS vector SCHEMA {project_name};

-- 기타 필요한 확장
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

---

### Phase 2: 테이블 마이그레이션

#### 2.1 테이블 구조 추출

**방법 A: pg_dump 사용**

```bash
# 기존 프로젝트에서 스키마만 추출
pg_dump -h {old_host} -U {user} -d {database} \
  --schema-only \
  --schema=public \
  -f {project_name}_schema.sql
```

**방법 B: Supabase Dashboard 사용**

1. Supabase Dashboard → SQL Editor
2. 다음 쿼리로 테이블 구조 확인:

```sql
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

#### 2.2 테이블 생성 스크립트 작성

기존 테이블 생성 스크립트를 새 스키마로 수정:

```sql
-- 기존: CREATE TABLE public.projects (...)
-- 수정: CREATE TABLE {project_name}.projects (...)

-- 예시: hdd 스키마로 마이그레이션
CREATE TABLE IF NOT EXISTS hdd.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volume_id uuid REFERENCES hdd.volumes(id),
  original_folder_name text NOT NULL,
  -- ... 나머지 컬럼
);
```

#### 2.3 제약 조건 및 인덱스 마이그레이션

```sql
-- 외래 키 제약 조건
ALTER TABLE {project_name}.{table}
  ADD CONSTRAINT {constraint_name}
  FOREIGN KEY ({column}) 
  REFERENCES {project_name}.{referenced_table}({referenced_column});

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_{table}_{columns}
  ON {project_name}.{table} ({columns});

-- UNIQUE 제약 조건
ALTER TABLE {project_name}.{table}
  ADD CONSTRAINT {constraint_name} UNIQUE ({columns});
```

#### 2.4 데이터 마이그레이션

**방법 A: INSERT ... SELECT (소규모 데이터)**

```sql
-- 기존 데이터를 새 스키마로 복사
INSERT INTO {new_schema}.{table} 
SELECT * FROM {old_schema}.{table};

-- 또는 특정 컬럼만 선택
INSERT INTO {new_schema}.{table} (col1, col2, col3)
SELECT col1, col2, col3 FROM {old_schema}.{table};
```

**방법 B: pg_dump/pg_restore (대규모 데이터)**

```bash
# 데이터만 추출
pg_dump -h {old_host} -U {user} -d {database} \
  --data-only \
  --schema=public \
  -f {project_name}_data.sql

# 새 스키마로 복원 (스키마 이름 변경 필요)
sed 's/public\./{project_name}./g' {project_name}_data.sql | \
  psql -h db.xiygbsaewuqocaxoxeqn.supabase.co -U postgres -d postgres
```

**방법 C: Supabase MCP 도구 사용**

```typescript
// MCP를 통한 데이터 마이그레이션 (예시)
// 실제 구현은 프로젝트별로 다를 수 있음
```

---

### Phase 3: RLS 정책 설정

#### 3.1 RLS 활성화

```sql
-- 모든 테이블에 RLS 활성화
ALTER TABLE {project_name}.{table} ENABLE ROW LEVEL SECURITY;
```

#### 3.2 RLS 정책 생성

```sql
-- 예시: 소유자 기반 정책
CREATE POLICY {policy_name}_select ON {project_name}.{table}
  FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY {policy_name}_insert ON {project_name}.{table}
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY {policy_name}_update ON {project_name}.{table}
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY {policy_name}_delete ON {project_name}.{table}
  FOR DELETE
  USING (owner_id = auth.uid());
```

#### 3.3 서비스 롤 접근 (필요한 경우)

서비스 롤은 RLS를 우회하므로 별도 정책 불필요:

```typescript
// 코드에서 Service Role Key 사용
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

---

### Phase 4: Public 스키마 뷰 생성 (필수) ⚠️

**⚠️ 중요**: PostgREST 제약으로 인해 이 단계는 **반드시 필요**합니다. Public 뷰 없이는 코드에서 테이블에 접근할 수 없습니다.

#### 4.1 뷰 생성

```sql
-- 기본 뷰 생성 (필수)
CREATE OR REPLACE VIEW public.{table_name} AS
SELECT * FROM {project_name}.{table_name};

-- RLS 상속 설정 (보안을 위해 필수)
ALTER VIEW public.{table_name} SET (security_invoker = true);
```

**모든 테이블에 대해 뷰 생성:**

```sql
-- 예시: vibememory 스키마의 모든 테이블에 대한 뷰 생성
CREATE OR REPLACE VIEW public.projects AS
SELECT * FROM vibememory.projects;

CREATE OR REPLACE VIEW public.project_screenshots AS
SELECT * FROM vibememory.project_screenshots;

CREATE OR REPLACE VIEW public.project_analysis AS
SELECT * FROM vibememory.project_analysis;

-- RLS 상속 설정
ALTER VIEW public.projects SET (security_invoker = true);
ALTER VIEW public.project_screenshots SET (security_invoker = true);
ALTER VIEW public.project_analysis SET (security_invoker = true);
```

**자동화 스크립트 (선택사항):**

```sql
-- 모든 테이블에 대해 뷰 자동 생성
DO $$
DECLARE
    table_record RECORD;
BEGIN
    FOR table_record IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = '{project_name}'
          AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format(
            'CREATE OR REPLACE VIEW public.%I AS SELECT * FROM %I.%I',
            table_record.table_name,
            '{project_name}',
            table_record.table_name
        );
        
        EXECUTE format(
            'ALTER VIEW public.%I SET (security_invoker = true)',
            table_record.table_name
        );
    END LOOP;
END $$;
```

#### 4.2 뷰 이름 충돌 해결

여러 프로젝트에 동일한 테이블 이름이 있는 경우:

**옵션 1: 접두사 사용**

```sql
CREATE OR REPLACE VIEW public.{project_name}_{table_name} AS
SELECT * FROM {project_name}.{table_name};
```

**옵션 2: 클라이언트에서 스키마 명시**

```typescript
// Supabase JS 클라이언트
const { data } = await supabase
  .schema('{project_name}')
  .from('{table_name}')
  .select('*');
```

---

### Phase 5: RPC 함수 마이그레이션

#### 5.1 함수 스키마 변경

```sql
-- 기존 함수
CREATE OR REPLACE FUNCTION public.{function_name}(...)
-- 수정: 새 스키마로 이동
CREATE OR REPLACE FUNCTION {project_name}.{function_name}(...)
```

#### 5.2 Public 래퍼 함수 생성 (선택사항)

Supabase JS 클라이언트 호환성을 위해:

```sql
CREATE OR REPLACE FUNCTION public.{function_name}(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN {project_name}.{function_name}(...);
END;
$$;
```

---

### Phase 6: Storage 버킷 마이그레이션

#### 6.1 버킷 생성

```sql
-- Supabase Dashboard 또는 SQL
INSERT INTO storage.buckets (id, name, public)
VALUES ('{project_name}-{bucket-name}', '{project_name}-{bucket-name}', false);
```

#### 6.2 Storage 정책 설정

```sql
-- 업로드 정책
CREATE POLICY "{policy_name}_upload"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = '{project_name}-{bucket-name}' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- 조회 정책
CREATE POLICY "{policy_name}_select"
ON storage.objects FOR SELECT
USING (
  bucket_id = '{project_name}-{bucket-name}' AND
  auth.uid()::text = (storage.foldername(name))[1]
);
```

---

### Phase 7: 코드 수정

#### 7.1 환경 변수 확인

`.env.local` 파일에 Supabase 정보가 올바르게 설정되어 있는지 확인:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xiygbsaewuqocaxoxeqn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

#### 7.2 Supabase 클라이언트 수정

**⚠️ 중요**: PostgREST 제약으로 인해 실제 테이블 스키마에 직접 접근할 수 없습니다. **반드시 Public 뷰를 통해 접근**해야 합니다.

**권장 방법: Public 뷰 사용 (필수)**

```typescript
// lib/supabase.ts
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: 'public' }  // Public 뷰를 통해 접근 (필수)
  }
);

// 사용 시
const { data } = await supabaseAdmin
  .from('{table_name}')  // public.{table_name} 뷰를 통해 실제 테이블 접근
  .select('*');
```

**구조 설명:**
- **DB 실제 테이블**: `{project_name}.{table_name}` (예: `vibememory.projects`)
- **Public 뷰**: `public.{table_name}` (예: `public.projects`)
- **코드 접근**: `public.{table_name}` 뷰 → 자동으로 `{project_name}.{table_name}` 테이블 조회

**❌ 사용 불가 (PGRST106 에러 발생):**

```typescript
// 이 방법은 작동하지 않습니다!
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: 'vibememory' }  // ❌ PostgREST가 이 스키마를 노출하지 않음
  }
);

// 또는
await supabaseAdmin
  .schema('vibememory')  // ❌ PGRST106 에러 발생
  .from('projects')
  .select('*');
```

**✅ 올바른 방법:**

```typescript
// Public 뷰를 통해 접근 (필수)
const { data } = await supabaseAdmin
  .from('projects')  // public.projects 뷰 사용
  .select('*');
```

#### 7.3 RPC 함수 호출 수정

**RPC 함수는 Public 래퍼를 통해 호출 (권장)**

대부분의 RPC 함수는 `public` 스키마에 래퍼 함수로 생성되어 있습니다:

```typescript
// Public 래퍼 함수 사용 (권장)
const { data } = await supabaseAdmin
  .schema('public')  // Public 스키마 명시 (선택사항, 기본값)
  .rpc('{function_name}', {
    param1: value1,
    param2: value2
  });
```

**실제 스키마의 함수를 직접 호출하는 경우:**

만약 실제 스키마의 함수를 직접 호출해야 하는 경우 (일반적이지 않음):

```typescript
// 실제 스키마 함수 호출 (public 래퍼가 없는 경우)
// 주의: PostgREST가 해당 스키마를 노출하지 않으면 실패할 수 있음
const { data } = await supabaseAdmin.rpc('{project_name}.{function_name}', {
  param1: value1,
  param2: value2
});
```

**권장 패턴:**

1. **Public 래퍼 함수 생성** (Phase 5 참조)
2. **코드에서는 Public 래퍼 사용**
3. **실제 로직은 스키마 함수에 구현**

---

## 코드 수정 가이드

### 패턴 1: Public 뷰를 통한 접근 (권장)

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// 모든 프로젝트는 Public 뷰를 통해 접근
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: 'public' }  // Public 뷰 사용 (필수)
  }
);

// 사용 시
const { data } = await supabaseAdmin
  .from('projects')  // public.projects 뷰 → 실제 스키마 테이블
  .select('*');
```

**⚠️ 주의**: PostgREST 제약으로 인해 실제 스키마에 직접 접근할 수 없으므로, 모든 접근은 Public 뷰를 통해야 합니다.

### 패턴 2: 헬퍼 함수 사용 (Public 뷰 기반)

```typescript
// lib/supabase-utils.ts
import { createClient } from '@supabase/supabase-js';

// 기본 클라이언트는 항상 public 스키마 사용
const baseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: 'public' }  // Public 뷰 사용
  }
);

// 헬퍼 함수 (필요한 경우)
export function getSupabaseClient() {
  return baseClient;  // 항상 public 스키마 반환
}

// 사용
const client = getSupabaseClient();
const { data } = await client
  .from('projects')  // public.projects 뷰 사용
  .select('*');
```

**참고**: PostgREST 제약으로 인해 실제 스키마를 지정할 수 없으므로, 모든 접근은 Public 뷰를 통해야 합니다.

### 패턴 3: 타입 안전성 확보

```typescript
// types/database.ts
export type HddProject = {
  id: string;
  volume_id: string;
  original_folder_name: string;
  // ...
};

// 사용
const { data } = await supabaseHdd
  .from('projects')
  .select('*')
  .returns<HddProject[]>();
```

---

## 테스트 및 검증

### 1. 데이터 무결성 검증

```sql
-- 레코드 수 비교
SELECT 
  'old_schema' as source,
  COUNT(*) as row_count
FROM {old_schema}.{table}
UNION ALL
SELECT 
  'new_schema' as source,
  COUNT(*) as row_count
FROM {new_schema}.{table};

-- 샘플 데이터 비교
SELECT * FROM {old_schema}.{table} LIMIT 10;
SELECT * FROM {new_schema}.{table} LIMIT 10;
```

### 2. 기능 테스트

- [ ] CRUD 작업 테스트
- [ ] RLS 정책 테스트
- [ ] RPC 함수 테스트
- [ ] Storage 업로드/다운로드 테스트
- [ ] 인덱스 성능 테스트

### 3. 성능 테스트

```sql
-- 쿼리 실행 계획 확인
EXPLAIN ANALYZE
SELECT * FROM {project_name}.{table}
WHERE {condition};

-- 인덱스 사용 확인
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans
FROM pg_stat_user_indexes
WHERE schemaname = '{project_name}';
```

---

## 롤백 계획

### 롤백 시나리오

1. **마이그레이션 실패 시**
   - 백업 파일로 복원
   - 기존 Supabase 프로젝트로 복귀

2. **데이터 손실 발견 시**
   - 백업에서 특정 테이블만 복원
   - 데이터 재마이그레이션

3. **성능 저하 시**
   - 인덱스 재생성
   - 쿼리 최적화
   - 필요 시 스키마 분리

### 롤백 절차

```bash
# 1. 백업 확인
ls -lh backup_*.sql

# 2. 특정 스키마만 삭제 (필요한 경우)
psql -h db.xiygbsaewuqocaxoxeqn.supabase.co -U postgres -d postgres \
  -c "DROP SCHEMA IF EXISTS {project_name} CASCADE;"

# 3. 백업 복원
psql -h db.xiygbsaewuqocaxoxeqn.supabase.co -U postgres -d postgres \
  -f backup_YYYYMMDD_HHMMSS.sql
```

---

## 체크리스트

### 사전 준비

- [ ] 현재 상태 백업 완료
- [ ] 마이그레이션 계획 문서화
- [ ] 테스트 환경 준비
- [ ] 다운타임 일정 수립

### 마이그레이션 실행

- [ ] 새 스키마 생성
- [ ] 확장 활성화 (필요한 경우)
- [ ] 테이블 구조 마이그레이션
- [ ] 제약 조건 및 인덱스 생성
- [ ] 데이터 마이그레이션
- [ ] RLS 정책 설정
- [ ] Public 뷰 생성
- [ ] RPC 함수 마이그레이션
- [ ] Storage 버킷 설정

### 코드 수정

- [ ] 환경 변수 확인
- [ ] Supabase 클라이언트 수정
- [ ] API 라우트 수정
- [ ] 타입 정의 업데이트
- [ ] 테스트 코드 수정

### 검증 및 테스트

- [ ] 데이터 무결성 검증
- [ ] 기능 테스트 통과
- [ ] 성능 테스트 통과
- [ ] 통합 테스트 통과

### 배포 및 모니터링

- [ ] 프로덕션 배포
- [ ] 모니터링 설정
- [ ] 에러 로그 확인
- [ ] 사용자 피드백 수집

---

## 주의사항

### 1. PostgREST 스키마 노출 제약 (가장 중요) ⚠️

**문제:**
- PostgREST는 기본적으로 `public` 스키마와 명시적으로 설정된 스키마만 노출
- 현재 허용된 스키마: `public`, `hdd`만
- 다른 스키마(예: `vibememory`)에 직접 접근 시 `PGRST106` 에러 발생

**해결책:**
- ✅ **반드시 Public 뷰를 생성**하여 실제 테이블에 접근
- ✅ 코드에서는 기본 스키마를 `public`으로 설정
- ✅ 모든 쿼리는 Public 뷰를 통해 수행

**에러 예시:**
```
PGRST106: The schema must be one of the following: public, hdd
```

**올바른 구조:**
```
실제 테이블: vibememory.projects
    ↓ (뷰 생성)
Public 뷰: public.projects
    ↓ (코드 접근)
코드: supabaseAdmin.from('projects')
```

### 2. 테이블 이름 충돌

여러 프로젝트에 동일한 테이블 이름이 있는 경우:
- Public 뷰 이름 충돌 가능
- 해결: 접두사 사용 (예: `public.vibememory_projects`, `public.hdd_projects`)

**예시:**
```sql
-- 충돌 방지: 접두사 사용
CREATE OR REPLACE VIEW public.vibememory_projects AS
SELECT * FROM vibememory.projects;

CREATE OR REPLACE VIEW public.hdd_projects AS
SELECT * FROM hdd.projects;
```

### 3. 외래 키 참조

다른 스키마의 테이블을 참조하는 경우:
- 스키마 간 외래 키는 가능하지만 권장하지 않음
- 해결: 공통 테이블은 별도 스키마로 분리

### 4. RLS 정책 복잡도

스키마 간 데이터 접근이 필요한 경우:
- RLS 정책이 복잡해질 수 있음
- 해결: 공통 함수 또는 뷰 사용
- **참고**: Public 뷰는 기본 테이블의 RLS 정책을 상속받습니다

### 5. 성능 고려사항

- Public 뷰는 성능 오버헤드가 미미하지만, 대용량 데이터에서는 주의
- 인덱스가 제대로 생성되었는지 확인
- 뷰는 실제 테이블의 인덱스를 사용하므로 성능 영향 최소

### 6. 마이그레이션 순서

의존성이 있는 테이블은 순서대로 마이그레이션:
1. 독립적인 테이블
2. 외래 키가 있는 테이블
3. **Public 뷰 생성** (필수)
4. RPC 함수 및 래퍼 함수

---

## 예시: VibeMemory 프로젝트 마이그레이션 (실제 적용 사례)

### 현재 상태

- **스키마**: `vibememory` (이미 존재)
- **테이블**: 26개
- **데이터**: 프로젝트, 스크린샷, 분석 데이터 등

### 마이그레이션 완료 상태

✅ 스키마 생성 완료  
✅ 테이블 생성 완료  
✅ 데이터 마이그레이션 완료  
✅ RLS 정책 설정 완료  
✅ **Public 뷰 생성 완료** (필수)  
✅ **코드 수정 완료** (Public 뷰 사용)

### 적용된 해결책

**문제 발생:**
- 코드에서 `.schema('vibememory')` 사용 시 `PGRST106` 에러 발생
- PostgREST가 `vibememory` 스키마를 노출하지 않음

**해결 과정:**
1. Public 뷰가 이미 존재함을 확인
2. 기본 스키마를 `public`으로 변경
3. 모든 `.schema('vibememory')` 호출 제거
4. Public 뷰를 통한 접근으로 전환

**최종 코드 구조:**
```typescript
// lib/supabase.ts
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    db: { schema: 'public' }  // Public 뷰 사용
  }
);

// 사용
await supabaseAdmin
  .from('projects')  // public.projects 뷰 → vibememory.projects 테이블
  .select('*');
```

### 예시: HDD 프로젝트 마이그레이션

### 현재 상태

- **스키마**: `hdd` (이미 존재, PostgREST에서 노출됨)
- **테이블**: 6개
- **데이터**: 물리적 디스크 11개, 볼륨 1개

### 마이그레이션 완료 상태

✅ 스키마 생성 완료  
✅ 테이블 생성 완료  
✅ 데이터 마이그레이션 완료 (또는 이미 존재)  
✅ RLS 정책 설정 완료  
✅ **PostgREST에서 직접 노출됨** (별도 뷰 불필요)

### 참고

- `hdd` 스키마는 PostgREST 설정에 포함되어 있어 직접 접근 가능
- `vibememory` 스키마는 Public 뷰를 통해 접근해야 함
- 새로운 프로젝트 추가 시 PostgREST 설정 확인 필요

---

## 참고 자료

- [Supabase 공식 문서](https://supabase.com/docs)
- [PostgreSQL 스키마 문서](https://www.postgresql.org/docs/current/ddl-schemas.html)
- [Supabase MCP 도구](https://supabase.com/docs/guides/cli)
- [프로젝트 내 DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- [PostgREST 스키마 노출 제약](https://postgrest.org/en/stable/api.html#schema-catalog)

## 실제 적용 사례 및 문제 해결

### VibeMemory 프로젝트 적용 사례

**문제:**
- `vibememory` 스키마에 직접 접근 시 `PGRST106` 에러 발생
- 에러 메시지: "The schema must be one of the following: public, hdd"

**원인:**
- PostgREST가 `vibememory` 스키마를 노출하지 않음
- 현재 허용된 스키마: `public`, `hdd`만

**해결:**
1. Public 뷰 확인 (이미 존재)
2. 코드에서 기본 스키마를 `public`으로 변경
3. 모든 `.schema('vibememory')` 호출 제거
4. Public 뷰를 통한 접근으로 전환

**결과:**
- ✅ 모든 기능 정상 작동
- ✅ 프로젝트 상세 페이지 정상 조회
- ✅ 스크린샷, 분석 데이터 정상 조회

**참고 문서:**
- `테스트_결과_분석.md` - 문제 원인 및 해결 과정
- `해결책_검토_보고서.md` - 해결책 검토 내용

---

## 문의 및 지원

마이그레이션 과정에서 문제가 발생하면:
1. 백업 파일 확인
2. 에러 로그 분석
3. Supabase Dashboard에서 SQL 실행 확인
4. 필요 시 롤백 실행

---

**문서 버전**: 1.0  
**최종 업데이트**: 2025-01-XX

