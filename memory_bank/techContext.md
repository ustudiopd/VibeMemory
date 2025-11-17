# 기술 스택 정보 (Tech Context)

## 1. 프레임워크 및 라이브러리  
- **언어 및 버전**: TypeScript, Node.js v20.x
- **핵심 프레임워크**: Next.js 14+ (App Router)
- **백엔드**: Next.js API Routes (TypeScript)
- **데이터베이스**: Supabase (PostgreSQL 17.6.1.044)
- **벡터 저장소**: Supabase (pgvector)
- **상태 관리**: React Query (TanStack Query v5)
- **UI 라이브러리**: Tailwind CSS, Shadcn/ui
- **AI / 임베딩**: OpenAI API (gpt-4.1-mini, text-embedding-3-small)
  - **모델**: GPT-4.1-mini (일반 모델)
    - 일반 모델 특성: `temperature`, `maxTokens` 파라미터 사용 가능
    - 모델명 정규화: 비ASCII 하이픈 처리 (`lib/model-utils.ts`)
    - maxTokens 제한: 2000-3000 토큰 (API별 상이)
    - temperature: 0.3-0.7 (API별 상이)
  - **임베딩**: text-embedding-3-small
- **AI 챗봇 SDK**: Vercel AI SDK
- **GitHub 연동**: @octokit/rest (GitHub API v3)
- **인증**: NextAuth.js (GitHub OAuth Provider)

## 2. 개발 환경  
- **패키지 매니저**: npm / yarn
- **Linter / Formatter**: ESLint, Prettier

## 3. 배포 환경  
- **호스팅**: Vercel (프론트엔드), Supabase (백엔드/데이터베이스)
- **CI/CD**: GitHub Actions
- **런타임 설정**:
  - Edge 런타임: 모든 API 라우트 (`export const runtime = 'edge'`)
  - maxDuration: 60초 (Pro 플랜 기준)

## 4. Supabase 프로젝트 정보
- **Project ID**: `xiygbsaewuqocaxoxeqn`
- **Project URL**: `https://xiygbsaewuqocaxoxeqn.supabase.co`
- **Database Host**: `db.xiygbsaewuqocaxoxeqn.supabase.co`
- **Region**: `ap-northeast-2` (Seoul)
- **PostgreSQL Version**: `17.6.1.044`
- **Status**: ACTIVE_HEALTHY
- **스키마**: `vibememory` (실제 사용 중)
- **Public 스키마 뷰**: Supabase JS 클라이언트 호환성을 위해 public 스키마에 뷰 생성
  - `public.projects` → `vibememory.projects`
  - `public.repo_files` → `vibememory.repo_files`
  - `public.repo_file_chunks` → `vibememory.repo_file_chunks`
  - `public.project_analysis` → `vibememory.project_analysis`
- **MCP 도구 활용**: 데이터베이스 마이그레이션, RLS 설정, SQL 실행 등은 Supabase MCP를 통해 수행

## 5. 환경 변수 설정 (.env.local)
다음 환경 변수들이 `.env.local` 파일에 설정되어 있습니다:

### Supabase 관련
- `SUPABASE_SERVICE_ROLE_KEY`: 서버 사이드에서 사용하는 서비스 롤 키 (민감 정보)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: 클라이언트 사이드에서 사용하는 익명 키
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase 프로젝트 URL (`https://xiygbsaewuqocaxoxeqn.supabase.co`)

### OpenAI 관련
- `OPENAI_API_KEY`: OpenAI API 키 (민감 정보)
- `CHATGPT_MODEL`: 사용할 ChatGPT 모델 (`gpt-4.1-mini`)

### GitHub 관련
- `GITHUB_CLIENT_ID`: GitHub OAuth App Client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth App Client Secret
- `GITHUB_WEBHOOK_SECRET`: GitHub Webhook 시크릿
- `SYSTEM_GITHUB_USERNAME`: 시스템에서 사용할 GitHub 사용자명 (`ustudiopd`)
- `SYSTEM_GITHUB_ACCESS_TOKEN`: 시스템 GitHub Personal Access Token

### NextAuth 관련
- `NEXTAUTH_SECRET`: NextAuth.js 세션 암호화 키
- `NEXT_PUBLIC_APP_URL`: 애플리케이션 URL

### 시스템 사용자 관련
- `SYSTEM_USER_EMAIL`: 시스템 사용자 이메일
- `SYSTEM_USER_NAME`: 시스템 사용자 이름

**참고**: 실제 키 값은 보안상 `.env.local` 파일에만 저장되며, Git에 커밋되지 않도록 `.gitignore`에 포함되어 있습니다.

## 6. 데이터베이스 RPC 함수
다음 RPC 함수들이 구현되어 있습니다:
- `public.claim_job(p_job_name, p_duration)`: 작업 잠금 관리
- `public.get_project_progress(p_project_id)`: 프로젝트 진행률 조회
- `public.get_user_projects(p_owner_id)`: 사용자 프로젝트 목록 조회
- `public.insert_repo_file_chunks(p_chunks)`: 벡터 임베딩 청크 삽입 (개선 필요)
- `vibememory.hybrid_search_rrf(...)`: 하이브리드 검색 (RRF)

