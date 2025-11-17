# VibeMemory 개발 진행 상황

## 완료된 작업

### Phase 7: GPT-5-mini 마이그레이션 ✅
- GPT-4.1-mini → GPT-5-mini 모델 변경
- 모든 API 엔드포인트에서 모델 이름 업데이트
- 빈 응답 체크 로직 추가 (GPT-5-mini 특성 대응)
- 명세서 생성 API에 상세 로깅 추가
- 변경된 파일:
  - `app/api/projects/[id]/chat/route.ts`
  - `app/api/chat/route.ts`
  - `lib/analysisService.ts`
  - `app/api/projects/[id]/tech-spec/generate/route.ts`
  - `app/api/projects/[id]/idea/synthesize/route.ts`

### Phase 0: 프로젝트 초기화 ✅
- Next.js 14+ 프로젝트 생성 (TypeScript, Tailwind CSS)
- 필수 패키지 설치 완료
- 기본 프로젝트 구조 생성

### Phase 1: 데이터베이스 인프라 ✅
- `vibememory` 스키마 생성
- pgvector 확장 활성화
- 핵심 테이블 4개 생성 (`projects`, `repo_files`, `repo_file_chunks`, `project_analysis`)
- 운영 테이블 3개 생성 (`job_locks`, `api_quota_tracking`, `project_phase_snapshots`)
- 인덱스 생성 (GIN, HNSW, B-tree)
- RLS 정책 적용 (모든 테이블)

### Phase 2: RPC 함수 구현 ✅
- `vibememory.claim_job` - 동시성 제어
- `vibememory.get_project_progress` - 진행률 계산
- `vibememory.hybrid_search_rrf` - RAG 하이브리드 검색

### Phase 3: 백엔드 API 구현 ✅
- GitHub OAuth 인증 (NextAuth.js)
- 프로젝트 임포트 API (`POST /api/projects/import`)
- 초기 스캔 로직 (`lib/runInitialScan`)
- GitHub Webhook (`POST /api/github/webhook`) - HMAC 검증
- 챗봇 API (`POST /api/chat`, `POST /api/projects/[id]/chat`) - SSE 스트리밍

### Phase 4: 운영 및 최적화 ✅
- 진행률 API (`GET /api/projects/:id/progress`)
- 야간 보정 Cron (`GET /api/cron/sanity-check`)

### Phase 5: 프론트엔드 ✅
- 기본 UI 구조 및 레이아웃
- 대시보드 페이지 (`/dashboard`)
- 프로젝트 임포트 페이지 (`/dashboard/import`)
- 프로젝트 상세 페이지 (`/dashboard/projects/[id]`)
- 챗봇 UI 컴포넌트 (Vercel AI SDK `useChat` 훅 사용)
- 진행률 시각화 (기본 진행 바)

### Phase 6: 스크린샷 갤러리 및 대표 이미지 기능 ✅
- 스크린샷 업로드 및 관리 기능
- 스크린샷 댓글 기능
- 대표 이미지 지정 기능 (`is_primary` 컬럼 추가)
- 프로젝트 카드에 썸네일 표시
- 대시보드 프로젝트 카드 레이아웃 개선 (제목 → 썸네일 → 날짜 → 설명)

## 생성된 주요 파일

### 인증 및 설정
- `lib/supabase.ts` - Supabase 클라이언트
- `lib/supabase-server.ts` - 서버 사이드 클라이언트
- `lib/auth.ts` - 인증 헬퍼
- `middleware.ts` - 인증 미들웨어
- `app/api/auth/[...nextauth]/route.ts` - NextAuth 핸들러
- `app/providers.tsx` - React Query 및 Session Provider

### GitHub 연동
- `lib/github.ts` - GitHub API 클라이언트

### RAG 및 AI
- `lib/rag.ts` - 텍스트 청킹 및 임베딩
- `lib/analysisService.ts` - AI 분석 서비스
- `lib/runInitialScan.ts` - 초기 스캔 로직

### API 엔드포인트
- `app/api/projects/import/route.ts`
- `app/api/github/webhook/route.ts`
- `app/api/chat/route.ts`
- `app/api/projects/[id]/chat/route.ts`
- `app/api/projects/[id]/progress/route.ts`
- `app/api/cron/sanity-check/route.ts`

### 프론트엔드
- `app/page.tsx` - 홈 페이지
- `app/dashboard/page.tsx` - 대시보드
- `app/dashboard/import/page.tsx` - 프로젝트 임포트
- `app/dashboard/projects/[id]/page.tsx` - 프로젝트 상세
- `components/ChatInterface.tsx` - 챗봇 UI 컴포넌트

## 다음 단계 (선택사항)

### 추가 기능
- [ ] GitHub 리포지토리 목록 API 구현
- [ ] 프로젝트 목록 조회 API 구현
- [ ] 진행률 시각화 컴포넌트 고도화 (PhaseRingGrid, Funnel 등)
- [ ] AI 분석 결과 표시 UI
- [ ] 릴리즈 노트 표시 UI

## 환경 변수 설정 필요

`.env.local` 파일에 다음 변수들을 설정해야 합니다:
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `CRON_SECRET` (선택사항)
- 기타 Supabase 및 OpenAI 키

## 알려진 이슈

1. Supabase 클라이언트는 스키마를 직접 지원하지 않으므로, 테이블 접근 시 검색 경로 설정이 필요할 수 있습니다.
2. GitHub access token 저장은 현재 user_metadata에 저장되며, 프로덕션에서는 암호화 저장을 권장합니다.
3. 프로젝트 목록 조회 API가 아직 구현되지 않았습니다 (대시보드에서 TODO로 표시됨).

## 실행 방법

```bash
# 개발 서버 실행
npm run dev

# 빌드
npm run build

# 프로덕션 실행
npm start
```
