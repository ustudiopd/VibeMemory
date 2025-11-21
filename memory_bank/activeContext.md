# 현재 작업 상황 (Active Context)

## 1. 현재 집중하고 있는 작업  
- **작업명**: PostgREST 스키마 제약 문제 해결 및 Public 뷰 전환 완료
- **목표**: 
  - PostgREST가 `vibememory` 스키마를 직접 노출하지 않는 문제 해결
  - Public 뷰를 통한 접근으로 전환
  - 모든 API 엔드포인트에서 스키마 명시 제거
  - 스키마 마이그레이션 가이드 업데이트
- **상태**: ✅ 구현 완료
- **다음 단계**: 다른 프로젝트 마이그레이션 시 동일 패턴 적용

## 2. 최근 완료된 작업 (2025-11-21)

### PostgREST 스키마 제약 문제 해결 및 Public 뷰 전환 (2025-11-21)
- ✅ **문제 진단**
  - `PGRST106` 에러 발생: "The schema must be one of the following: public, hdd"
  - PostgREST가 `vibememory` 스키마를 직접 노출하지 않음
  - 테스트 엔드포인트 생성 (`/api/test/project-check`)으로 문제 확인
- ✅ **해결책 적용**
  - 기본 스키마를 `public`으로 변경 (`lib/supabase.ts`)
  - 모든 `.schema('vibememory')` 호출 제거
  - Public 뷰를 통한 접근으로 전환
- ✅ **수정된 파일**
  - `lib/supabase.ts` - 기본 스키마 변경
  - `app/api/projects/route.ts` - 스키마 명시 제거
  - `app/api/projects/[id]/screenshots/route.ts` - 스키마 명시 제거
  - `app/api/projects/[id]/analysis/route.ts` - 스키마 명시 제거
  - `app/api/projects/[id]/chat/route.ts` - 스키마 명시 제거
  - `app/api/projects/[id]/comments/route.ts` - 스키마 명시 제거
  - `app/api/projects/[id]/progress/route.ts` - 스키마 명시 제거
  - `app/api/projects/[id]/route.ts` - 스키마 명시 제거
- ✅ **문서 업데이트**
  - `SUPABASE_MIGRATION_GUIDE.md` 업데이트
  - PostgREST 제약 사항 명시
  - Public 뷰 사용이 필수임을 강조
  - 실제 적용 사례 추가 (VibeMemory 프로젝트)
- ✅ **테스트 및 검증**
  - 프로젝트 상세 페이지 정상 작동 확인
  - 스크린샷 조회 정상 작동 확인
  - 분석 데이터 조회 정상 작동 확인

### 웹훅 연동 신뢰성 및 성능 개선 (2025-01-XX)
- ✅ **런타임 설정 추가**
  - `app/api/github/webhook/route.ts`에 Node.js 런타임 및 maxDuration 설정
  - crypto 모듈 및 Service Role Key 사용 안전성 확보
- ✅ **Idempotency 보장**
  - `webhook_deliveries` 테이블 생성 (Supabase MCP)
  - `X-GitHub-Delivery` 헤더 기반 중복 처리 방지
  - 처리 상태 추적 (pending, processing, done, error)
- ✅ **브랜치 필터링**
  - 기본 브랜치(`repository.default_branch`)만 처리
  - 다른 브랜치 push는 기록만 남기고 200 OK 반환
- ✅ **상관관계 ID 로깅**
  - 모든 로그에 `deliveryId`, `projectId`, `jobName` 포함
  - `logContext` 객체로 일관된 로깅
- ✅ **GitHub API 재시도 적용**
  - `lib/github.ts`에 `withRetry` 유틸리티 추가
  - 429(Rate Limit) 및 5xx 에러에 지수 백오프 재시도
  - `getFileContentWithSha`에 재시도 로직 적용
- ✅ **빠른 ACK + 작업 큐 시스템**
  - `webhook_jobs` 테이블 생성 (Supabase MCP)
  - 웹훅 라우트를 빠른 ACK 방식으로 변경 (검증 → 큐 등록 → 즉시 200 OK)
  - `/api/cron/process-webhook-jobs` 워커 라우트 생성
  - 배치 처리 (한 번에 최대 5개 작업)
  - 재시도 메커니즘 (최대 3회, 지수 백오프)
  - Vercel Cron 설정 추가 (매 1분마다 실행)
- ✅ **Compare API로 변경 파일 재검증**
  - `lib/github.ts`에 `getChangedFilesFromCompare` 함수 추가
  - push 이벤트의 `before`/`after` SHA로 Compare API 호출
  - 변경 파일 목록 정확도 향상 (중복 제거, renamed 처리)
  - Fallback: Compare API 실패 시 기존 commit 데이터 사용
- ✅ **야간 배치로 Old 청크 정리**
  - `/api/cron/cleanup-old-chunks` 크론 작업 생성
  - 30일 이상 된 `is_current=false` 청크 자동 삭제
  - 배치 처리 (한 번에 최대 1000개 청크)
  - Orphaned files 정리 (청크가 없는 `is_current=false` 파일 삭제)
  - Vercel Cron 설정 추가 (매일 새벽 2시 실행)

### GPT-4.1-mini로 롤백 및 max_tokens 제한 복원 (2025-01-XX)
- ✅ **모델 롤백** (`gpt-5-mini` → `gpt-4.1-mini`)
  - 모든 API 엔드포인트에서 모델 이름 변경
  - `app/api/projects/[id]/chat/route.ts`
  - `app/api/chat/route.ts`
  - `lib/analysisService.ts`
  - `app/api/projects/[id]/tech-spec/generate/route.ts`
  - `app/api/projects/[id]/idea/synthesize/route.ts`
- ✅ **max_tokens 제한 복원**
  - 모든 API에서 `maxTokens` 옵션 복원 (2000-3000 토큰)
  - `temperature` 옵션 사용 (0.3-0.7)
  - Reasoning 모델 분기 처리 제거
- ✅ **코드 정리**
  - `lib/model-utils.ts`에서 Reasoning 모델 감지 로직 제거
  - `isReasoningModel` 함수 제거
  - `getModelOptions` 함수 단순화 (항상 옵션 반환)
- ✅ **에러 메시지 업데이트**
  - 모든 에러 메시지에서 모델명 변경 (GPT-5-mini → GPT-4.1-mini)

### 아이디어 캔버스 파일 미리보기 기능 (2025-01-XX)
- ✅ **파일 미리보기 API 구현**
  - `GET /api/projects/[id]/idea/files/[fileId]` 엔드포인트 생성
  - Storage에서 파일 내용 읽기
  - txt, md 파일만 미리보기 지원
  - 프로젝트 소유권 확인 및 보안 검증
- ✅ **UI 개선**
  - `IdeaNoteTab` 컴포넌트에 미리보기 모달 추가
  - txt, md 파일에만 "미리보기" 버튼 표시
  - react-markdown을 사용한 마크다운 렌더링 (제목, 리스트, 코드 블록, 링크 등)
  - txt 파일은 pre 태그로 표시
  - 로딩 상태 및 에러 처리
  - 반응형 모달 디자인

### GPT-5-mini 마이그레이션 및 Vercel 배포 최적화 (2025-01-XX)
- ✅ **모델 마이그레이션** (`gpt-4o-mini` → `gpt-5-mini`)
  - 모든 API 엔드포인트에서 모델 이름 변경
  - `app/api/projects/[id]/chat/route.ts`
  - `app/api/chat/route.ts`
  - `lib/analysisService.ts`
  - `app/api/projects/[id]/tech-spec/generate/route.ts`
  - `app/api/projects/[id]/idea/synthesize/route.ts`
- ✅ **해결책.md 권장사항 적용**
  - Edge 런타임 + maxDuration 설정 (스트리밍 API)
  - Node.js 런타임 + maxDuration 300초 (긴 처리 시간 필요한 API)
  - Reasoning 모델 분기 처리 (`lib/model-utils.ts` 생성)
  - 모델명 정규화 (비ASCII 하이픈 처리)
  - 빈 스트림 폴백 로직 (gpt-4o-mini로 자동 재시도)
- ✅ **기술 스택 생성 API 타임아웃 해결**
  - 504 Gateway Timeout 에러 해결
  - Edge → Node.js 런타임 변경 (`tech-spec/generate` API)
  - maxDuration 60초 → 300초로 증가
  - 프롬프트 길이 제한 추가 (기술 리뷰 최대 3000자)
  - 프론트엔드 에러 핸들링 개선 (Content-Type 확인, JSON 파싱 에러 처리)
- ✅ **코드 품질 개선**
  - 공통 유틸리티 함수 생성 (`lib/model-utils.ts`)
  - Usage 정보 처리 개선 (onFinish → result.usage)
  - 빈 응답 체크 로직 개선 (chunkCount 기반)
  - 상세한 로깅 추가
- ✅ **문서 작성**
  - `해결책_검토_리포트.md` 생성
  - `GPT-5-mini_마이그레이션_가이드.md` 참조

### 이전 작업 (2025-01-16)

### 대표 이미지 지정 기능 구현
- ✅ `project_screenshots` 테이블에 `is_primary` 컬럼 추가
- ✅ 프로젝트당 하나의 대표 이미지만 허용하는 부분 유니크 인덱스 생성
- ✅ 스크린샷 업데이트 API에 `is_primary` 설정/해제 기능 추가
- ✅ 프로젝트 목록 API에 대표 이미지 정보 포함
- ✅ 대표 이미지 썸네일 URL API 추가 (`/api/projects/[id]/thumbnail`)
- ✅ ScreenshotItem 컴포넌트에 별표시(⭐) 버튼 추가
- ✅ 대표 이미지 설정/해제 기능 구현
- ✅ ProjectCard 컴포넌트 생성 및 썸네일 표시 기능 추가
- ✅ 대시보드 프로젝트 카드 레이아웃 개선 (제목 → 썸네일 → 날짜 → 설명 순서)

### 이전 작업 (2025-01-16)

### Citations 테이블 전환
- ✅ `chat_message_citations` 테이블 생성 및 마이그레이션
- ✅ 메시지 저장 시 Citations 테이블에 저장
- ✅ 메시지 조회 시 Citations JOIN하여 조회
- ✅ 청크 조회 API 추가 (`/api/projects/[id]/chunks/[chunkId]`)
- ✅ 출처 클릭 시 청크 미리보기 기능 추가
- ✅ `ChunkPreview` 컴포넌트 생성

### Cron Worker 인증 수정
- ✅ Vercel Cron 인증 방식 수정 (`x-vercel-cron` 헤더 지원)
- ✅ 401 에러 해결

### 이전 작업 (2025-11-15)

### 성능 최적화 및 코드 품질 개선
- ✅ **병렬 처리 구현**
  - `lib/runInitialScan.ts`에 `Promise.allSettled()` 사용
  - 3개 파일씩 동시 처리 (배치 단위)
  - 예상 성능 개선: 60-70% 시간 단축
- ✅ **Storage 버킷 확인 최적화**
  - `lib/storage.ts`에 캐싱 로직 추가
  - 한 번만 확인하고 결과 저장
  - 예상 성능 개선: 약 10% 시간 단축
- ✅ **진행 상태 업데이트 빈도 조정**
  - 각 파일마다 → 3개 파일마다 한 번씩 업데이트
  - DB 쿼리 수 감소
- ✅ **에러 로깅 개선**
  - `lib/utils/logger.ts` 생성 (구조화된 로깅)
  - JSON 형식 로그, 컨텍스트 정보 포함
  - 에러 레벨 분류 (DEBUG, INFO, WARN, ERROR)
- ✅ **재시도 메커니즘 강화**
  - `lib/utils/retry.ts` 생성 (지수 백오프 재시도)
  - `getFileContent`, `embedChunks`, `getRepositoryTree`에 적용
  - 최대 3회 재시도, 자동 복구
- ✅ **프로젝트 만들기 기능 플랜 작성**
  - `프로젝트_만들기_기능_플랜.md` 생성
  - 데이터베이스 스키마 변경 계획
  - 백엔드/프론트엔드 구현 계획

### 배포 및 인프라
- ✅ **빌드 성공 확인**
  - Next.js 빌드 오류 없음
  - middleware.ts 삭제로 deprecated 경고 해결
- ✅ **GitHub 리포지토리 생성 및 푸시**
  - 리포지토리: `ustudiopd/VibeMemory`
  - 초기 커밋 완료 (84개 파일, 16,559줄)
- ✅ **Vercel 배포 가이드 작성**
  - `VERCEL_DEPLOYMENT.md` 생성
  - 환경 변수 설정 가이드 포함
  - 웹훅 URL 설정 방법 설명
- ✅ **파일 스캔 최적화**
  - 메모리뱅크 전용 스캔으로 변경 (`memory_bank/` 디렉토리만)
  - 파일 타입(`blob`) 확인 추가
  - 디버깅 로그 추가
  - 중복 필터링 제거
  - 96개 파일 → 약 6개 파일로 감소 (타임아웃 문제 해결)
- ✅ **프로젝트 임포트 버그 수정**
  - 삭제된 프로젝트 재임포트 시 잠금 문제 해결
  - 프로젝트가 존재하지 않을 때 잠금 강제 삭제 로직 추가

### 이전 작업 (2025-11-15)
- ✅ **프로젝트 삭제 기능 구현** (API + UI)
  - `DELETE /api/projects/[id]` 엔드포인트 완성
  - 대시보드 UI에 삭제 버튼 및 확인 다이얼로그 추가
  - GitHub Webhook 자동 삭제 포함
  - JSX 구조 오류 수정 완료
- ✅ **프로젝트 임포트 파이프라인 리포트 작성** 
  - `PROJECT_IMPORT_PIPELINE_REPORT.md` 생성
  - 현재 구현 상태 상세 분석
  - 문제점 식별 및 해결 방안 제시
  - 우선순위별 작업 계획 수립
- ✅ **Vector 타입 삽입을 위한 RPC 함수 생성**
  - `insert_repo_file_chunks` RPC 함수 생성
  - 벡터 변환 로직 포함 (개선 필요)
  - `lib/runInitialScan.ts`에서 RPC 함수 사용하도록 수정
- ✅ **데이터베이스 접근 문제 해결**
  - public 스키마 뷰 생성 (`projects`, `repo_files`, `repo_file_chunks`, `project_analysis`)
  - RLS 및 권한 설정 개선
  - `get_user_projects` RPC 함수 생성
  - `get_project_progress` RPC 함수를 public 스키마로 이동
- ✅ **에러 핸들링 개선**
  - 프로젝트 임포트 시 중복 체크 로직 개선
  - 에러 메시지 개선 및 리다이렉션 처리
  - `single()` 사용 문제 수정 (`limit(1)` 사용)

## 3. 발견된 주요 문제점

### 🔴 긴급 (Critical)
1. ✅ **파일 스캔 최적화** (해결됨)
   - **문제**: 96개 파일 스캔 시 Vercel 타임아웃 발생 (300초 제한)
   - **해결**: 메모리뱅크 디렉토리만 스캔하도록 변경
   - **결과**: 약 6개 파일만 스캔하여 타임아웃 문제 해결
   - **상태**: 완료

2. **P2 임베딩 단계 실패** (이전 이슈)
   - **문제**: Vector 타입을 Supabase JS 클라이언트로 직접 삽입 시 타입 변환 실패
   - **현황**: 0개 청크 저장됨 (임베딩이 완전히 실패)
   - **해결 방안**: RPC 함수 `insert_repo_file_chunks` 생성 완료
   - **우선순위**: 높음

### 🟡 중요 (High)
3. ✅ **에러 추적 불가** (해결됨)
   - **문제**: 비동기 실행으로 인한 에러 추적 어려움
   - **해결**: 구조화된 로깅 시스템 구현 (`lib/utils/logger.ts`)
   - **상태**: 완료

4. ✅ **진행 상태 피드백 없음** (해결됨)
   - **문제**: 사용자가 프로젝트 임포트 진행 상황을 알 수 없음
   - **해결**: SSE 스트리밍 구현 (`/api/projects/[id]/progress/stream`)
   - **상태**: 완료

5. ✅ **재시도 메커니즘 없음** (해결됨)
   - **문제**: 일시적 실패 시 수동 재실행 필요
   - **해결**: 지수 백오프 재시도 로직 구현 (`lib/utils/retry.ts`)
   - **상태**: 완료

## 4. 다음 예정 작업 (우선순위 순)

### Phase 1: 프로젝트 만들기 기능 구현 (7-10시간)
1. **데이터베이스 스키마 변경**
   - `project_type` ENUM 추가 (`'github' | 'idea'`)
   - GitHub 관련 필드 nullable 변경
   - 제약 조건 추가
   - 인덱스 추가

2. **백엔드 API 구현**
   - `POST /api/projects/create` API 생성
   - 프로젝트 목록/상세 API 수정
   - 프로젝트 타입 검증 로직 추가

3. **프론트엔드 UI 구현**
   - `/dashboard/create` 페이지 생성
   - 대시보드에 만들기 버튼 추가
   - 프로젝트 상세 페이지 조건부 렌더링
   - 모바일 탭바 수정 (선택적)

4. **테스트 및 검증**
   - 아이디어 프로젝트 생성 테스트
   - 프로젝트 목록/상세 페이지 테스트
   - 챗봇/댓글 기능 테스트

### Phase 2: 추가 개선 (향후)
- 아이디어 프로젝트 챗봇 기능 (간단한 프롬프트 기반)
- 아이디어 프로젝트 문서 추가 기능
- 프로젝트 타입별 통계 및 분석

## 5. 주요 이슈 및 블로커  
- **해결된 이슈**: 
  - ✅ 파일 스캔 타임아웃 문제 (메모리뱅크 전용 스캔으로 해결)
  - ✅ P2 임베딩 단계 실패 (RPC 함수로 해결 완료)
  - ✅ 성능 최적화 (병렬 처리, Storage 최적화, 진행 상태 업데이트 빈도 조정)
  - ✅ 에러 로깅 개선 (구조화된 로깅 시스템)
  - ✅ 재시도 메커니즘 강화 (지수 백오프 재시도)
- **현재 상태**: 
  - 메모리뱅크 파일만 스캔하여 타임아웃 없이 정상 작동
  - 성능 최적화 완료 (60-70% 시간 단축 예상)
  - 코드 품질 개선 완료 (로깅, 재시도 메커니즘)

## 6. 참고 문서
- `VERCEL_DEPLOYMENT.md`: Vercel 배포 가이드 및 환경 변수 설정
- `PROJECT_IMPORT_PIPELINE_REPORT.md`: 프로젝트 임포트 파이프라인 상세 분석 리포트
- `프로젝트_만들기_기능_플랜.md`: 프로젝트 만들기(아이디어 생성) 기능 구현 플랜
- `코드_리뷰_구현_확인.md`: 코드 리뷰 및 구현 여부 확인 리포트
- `남은_작업_목록.md`: 남은 작업 목록 및 우선순위
- `plan.md`: 전체 프로젝트 명세서
- `ENV_SETUP.md`: 로컬 개발 환경 변수 설정 가이드
- `GITHUB_OAUTH_SETUP.md`: GitHub OAuth 설정 가이드

## 7. 배포 정보
- **GitHub 리포지토리**: https://github.com/ustudiopd/VibeMemory
- **Vercel 배포 URL**: https://vibe-memory.vercel.app
- **배포 상태**: 성공 (빌드 오류 없음)

