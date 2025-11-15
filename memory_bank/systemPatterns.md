# 시스템 아키텍처 및 패턴 (System Patterns)

## 1. 전체 아키텍처  
- **아키텍처 스타일**: Full-Stack Next.js 애플리케이션 (Monolithic)
- **프론트엔드**: Next.js 14+ App Router (React Server Components + Client Components)
- **백엔드**: Next.js API Routes (Serverless Functions)
- **데이터베이스**: Supabase (PostgreSQL + pgvector)
- **인증**: 시스템 사용자 모드 (NextAuth.js 비활성화, 환경 변수 기반)
- **외부 서비스**: 
  - GitHub API (리포지토리 관리, Webhook)
  - OpenAI API (LLM, Embeddings)

## 2. 주요 디자인 패턴  

### 2.1 데이터베이스 패턴
- **스키마 격리**: `vibememory` 스키마로 비즈니스 로직 테이블 격리
- **Public 뷰 패턴**: Supabase JS 클라이언트 호환성을 위해 `public` 스키마에 뷰 생성
- **RLS (Row Level Security)**: 모든 테이블에 `owner_id = auth.uid()` 기준 정책 적용
- **CASCADE 삭제**: 프로젝트 삭제 시 관련 데이터 자동 정리

### 2.2 API 패턴
- **RESTful API**: Next.js API Routes 사용
- **RPC 패턴**: 복잡한 데이터베이스 작업은 PostgreSQL RPC 함수로 처리
- **비동기 작업**: 초기 스캔 등 긴 작업은 비동기로 실행
- **동시성 제어**: `job_locks` 테이블과 `claim_job` RPC로 중복 실행 방지

### 2.3 에러 핸들링 패턴
- **Fallback 메커니즘**: RPC 실패 시 직접 테이블 접근으로 fallback
- **에러 로깅**: 콘솔 로그 + 구조화된 에러 메시지
- **사용자 피드백**: 명확한 에러 메시지 및 상태 표시

### 2.4 상태 관리 패턴
- **서버 상태**: React Query (TanStack Query) 사용
- **클라이언트 상태**: React useState/useEffect
- **시스템 사용자**: 환경 변수 기반, 세션 불필요

## 3. 코딩 컨벤션  

### 3.1 네이밍 규칙
- **TypeScript/JavaScript**: 
  - 변수/함수: `camelCase` (예: `fetchProjects`, `handleDelete`)
  - 컴포넌트: `PascalCase` (예: `DashboardPage`, `ChatInterface`)
  - 상수: `UPPER_SNAKE_CASE` (예: `CHUNK_SIZE`, `CHUNK_OVERLAP`)
- **SQL/데이터베이스**:
  - 테이블/컬럼: `snake_case` (예: `repo_files`, `is_current`)
  - RPC 함수: `snake_case` (예: `get_project_progress`, `claim_job`)
- **파일명**:
  - React 컴포넌트: `PascalCase.tsx` (예: `DashboardPage.tsx`)
  - 유틸리티/라이브러리: `camelCase.ts` (예: `runInitialScan.ts`)
  - API Routes: `route.ts` (예: `app/api/projects/route.ts`)

### 3.2 코드 구조
- **파일 상단**: 모듈 설명 주석
- **의존성 임포트**: 표준 라이브러리 → 서드파티 → 내부 모듈 순
- **상수 정의**: 파일 상단에 상수 정의
- **함수/클래스 정의**: 비즈니스 로직
- **메인 실행 블록**: 스크립트로 실행될 경우만

### 3.3 에러 처리
- **모든 외부 연동**: try-catch로 예외 처리
- **사용자 메시지**: 이해하기 쉬운 에러 메시지
- **로그**: 디버깅에 용이한 상세 정보

### 3.4 타입 안정성
- **TypeScript**: 명확한 타입 정의, `any` 사용 최소화
- **인터페이스**: 데이터 구조는 인터페이스로 정의
- **타입 가드**: 런타임 타입 검증

## 4. 주요 구현 패턴

### 4.1 프로젝트 임포트 파이프라인
1. **CLAIM**: `claim_job` RPC로 동시 실행 방지
2. **검증**: 중복 프로젝트 확인
3. **생성**: 프로젝트 레코드 생성
4. **Webhook**: GitHub Webhook 등록
5. **비동기 스캔**: `runInitialScan` 비동기 실행

### 4.2 초기 스캔 프로세스
1. **P1 인덱싱**: GitHub API로 MD 파일 트리 수집 → `repo_files` 저장
2. **P2 임베딩**: 파일 내용 청킹 → OpenAI Embeddings → `repo_file_chunks` 저장
3. **P3 AI 리뷰**: 핵심 파일 분석 → `project_analysis` 저장

### 4.3 Vector 타입 처리
- **문제**: Supabase JS 클라이언트가 `vector` 타입 직접 지원 안 함
- **해결**: RPC 함수를 통한 타입 변환 (JSONB → float8[] → vector)
- **패턴**: `insert_repo_file_chunks` RPC 함수 사용

### 4.4 데이터베이스 접근
- **서버 사이드**: `supabaseAdmin` (service_role 키 사용)
- **클라이언트 사이드**: `supabase` (anon 키 사용, 현재 미사용)
- **뷰 패턴**: `public` 스키마 뷰를 통해 `vibememory` 테이블 접근
- **RPC 우선**: 복잡한 쿼리는 RPC 함수 사용

## 5. 보안 패턴
- **환경 변수**: 민감한 정보는 `.env.local`에 저장
- **RLS**: 데이터베이스 레벨 접근 제어
- **소유권 검증**: 모든 API에서 프로젝트 소유권 확인
- **시스템 사용자**: 환경 변수 기반 인증, 세션 불필요

