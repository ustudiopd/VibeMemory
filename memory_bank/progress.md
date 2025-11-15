# 완료된 작업 내역 (Progress)

## [2025-11-15] - 프로젝트 임포트 개선 및 버그 수정
- **삭제된 프로젝트 재임포트 문제 해결**:
  - `app/api/projects/import/route.ts` 수정
  - 프로젝트가 존재하지 않을 때 잠금(`job_locks`) 강제 삭제 로직 추가
  - 삭제된 프로젝트의 리포지토리를 다시 임포트할 수 있도록 개선
  - 잠금 획득 실패 시 프로젝트 존재 여부 확인 후 재시도 로직 추가

## [2025-11-15] - 파일 스캔 최적화 및 타임아웃 문제 해결
- **메모리뱅크 전용 스캔으로 변경**:
  - `lib/github.ts`의 `getRepositoryTree` 함수 수정
  - `memory_bank/` 디렉토리 내의 MD 파일만 스캔하도록 필터링 추가
  - 96개 파일 → 약 6개 파일로 감소 (타임아웃 문제 해결)
  - Vercel 300초 타임아웃 이내 완료 가능하도록 최적화
- **파일 스캔 로직 개선**:
  - 파일 타입 확인 추가 (`type === 'blob'` 필터링)
  - 디버깅 로그 추가 (발견된 MD 파일 목록 출력)
  - GitHub API tree truncated 체크 추가
  - `lib/runInitialScan.ts`에서 중복 필터링 제거
- **빌드 및 배포 준비**:
  - Next.js 빌드 성공 확인 (오류 없음)
  - middleware.ts 파일 삭제 (Next.js 16 deprecated 경고 해결)
  - GitHub 리포지토리 생성 및 초기 커밋 푸시
  - Vercel 배포 가이드 문서 작성 (`VERCEL_DEPLOYMENT.md`)
- **환경 변수 설정 가이드**:
  - Vercel 배포 시 필요한 환경 변수 목록 정리
  - 웹훅 URL 자동 생성 로직 확인
  - GitHub OAuth Callback URL 설정 가이드

## [2025-11-15] - 프로젝트 임포트 파이프라인 개선 및 기능 추가
- **프로젝트 삭제 기능 구현**: 
  - `DELETE /api/projects/[id]` API 엔드포인트 생성 (`app/api/projects/[id]/route.ts`)
  - 프로젝트 소유권 확인 및 검증
  - GitHub Webhook 자동 삭제 기능 포함
  - CASCADE 삭제로 관련 데이터 자동 정리
  - 대시보드 프로젝트 목록에 삭제 버튼 추가
  - 삭제 확인 다이얼로그 구현 (모달)
  - 삭제 중 상태 표시 및 에러 처리
  - JSX 구조 오류 수정 (다이얼로그 위치 조정)
- **프로젝트 임포트 파이프라인 리포트 작성**: 
  - `PROJECT_IMPORT_PIPELINE_REPORT.md` 생성
  - 현재 구현 상태 분석
  - 문제점 식별 및 해결 방안 제시
  - 우선순위별 작업 계획 수립
- **Vector 타입 삽입 RPC 함수 생성**: 
  - `insert_repo_file_chunks` RPC 함수 생성 (벡터 변환 로직 포함)
  - `lib/runInitialScan.ts`에서 RPC 함수 사용하도록 수정
- **데이터베이스 접근 문제 해결**: 
  - public 스키마 뷰 생성 (`projects`, `repo_files`, `repo_file_chunks`, `project_analysis`)
  - RLS 및 권한 설정 개선
  - `get_user_projects` RPC 함수 생성
  - `get_project_progress` RPC 함수를 public 스키마로 이동
- **에러 핸들링 개선**: 
  - 프로젝트 임포트 시 중복 체크 로직 개선
  - 에러 메시지 개선 및 리다이렉션 처리

## [2025-11-14] - 프로젝트 임포트 및 초기 스캔 기능
- **프로젝트 임포트 API 구현**: 
  - `POST /api/projects/import` 엔드포인트
  - GitHub 리포지토리 정보 수신 및 저장
  - 중복 임포트 방지
  - 동시성 제어 (`claim_job` RPC 사용)
  - Webhook 생성
  - 비동기 초기 스캔 트리거
- **초기 스캔 로직 구현**: 
  - `lib/runInitialScan.ts` 함수 구현
  - GitHub API를 통한 MD 파일 트리 수집
  - 파일 메타데이터 저장 (P1: 인덱싱)
  - 청킹 및 임베딩 시도 (P2: 임베딩 - 현재 실패)
  - AI 분석 호출 (P3: AI 리뷰 - P2 실패로 미실행)
- **RAG 처리 로직 구현**: 
  - `lib/rag.ts` - 텍스트 청킹 (1000자, 200자 오버랩)
  - OpenAI Embeddings API 호출
  - 벡터 임베딩 생성 (1536차원)
- **AI 분석 서비스 구현**: 
  - `lib/analysisService.ts` - 핵심 파일 수집 및 분석
  - 아이디어 리뷰, 기술 리뷰, 특허 분석 생성
  - 결과 저장 (`project_analysis` 테이블)
- **프로젝트 상세 페이지 구현**: 
  - 프로젝트 요약 표시 (AI 분석 결과)
  - 진행률 표시 (P1-P5)
  - 프로젝트 챗봇 인터페이스
- **대시보드 페이지 구현**: 
  - 프로젝트 목록 표시
  - 시스템 사용자 정보 표시
  - 프로젝트 가져오기 링크

## [2025-11-13] - 데이터베이스 스키마 및 인프라 구축
- **데이터베이스 스키마 생성**: 
  - `vibememory.projects` 테이블
  - `vibememory.repo_files` 테이블
  - `vibememory.repo_file_chunks` 테이블 (벡터 임베딩 포함)
  - `vibememory.project_analysis` 테이블
  - `vibememory.job_locks` 테이블 (동시성 제어)
  - `vibememory.api_quota_tracking` 테이블
  - `vibememory.project_phase_snapshots` 테이블
- **RPC 함수 구현**: 
  - `claim_job` - 작업 잠금 관리
  - `get_project_progress` - 진행률 조회
  - `hybrid_search_rrf` - 하이브리드 검색 (RRF)
- **RLS 정책 설정**: 
  - 모든 테이블에 RLS 활성화
  - `owner_id = auth.uid()` 기준 정책 적용
- **인덱스 생성**: 
  - GIN 인덱스 (FTS)
  - HNSW 인덱스 (벡터 검색)
  - B-tree 인덱스 (일반 쿼리)

## [2025-11-12] - 프로젝트 초기 설정
- **Next.js 프로젝트 초기화**: 
  - Next.js 14+ (App Router) 설정
  - TypeScript 설정
  - Tailwind CSS 설정
- **의존성 설치**: 
  - Supabase 클라이언트
  - OpenAI SDK
  - Octokit (GitHub API)
  - NextAuth.js
  - Vercel AI SDK
- **환경 변수 설정**: 
  - Supabase 연결 정보
  - OpenAI API 키
  - GitHub OAuth 설정
  - NextAuth 설정
- **메모리뱅크 구조 생성**: 
  - `projectbrief.md`
  - `techContext.md`
  - `systemPatterns.md`
  - `productContext.md`
  - `activeContext.md`
  - `progress.md`

