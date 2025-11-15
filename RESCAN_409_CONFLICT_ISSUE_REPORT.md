# 재스캔 409 Conflict 에러 문제 리포트

**작성일**: 2025-11-15  
**문제 발생 시간**: 프로젝트 재스캔 시도 시  
**심각도**: 🔴 High (기능 블로커)

---

## 문제 요약

프로젝트 상세 페이지에서 "🔄 재스캔" 버튼을 클릭하면 **409 Conflict** 에러가 발생하며, 재스캔이 실행되지 않습니다.

### 에러 메시지
```
POST http://localhost:3000/api/projects/a535134d-ccbc-41d5-a848-037a8e0d2140/rescan 409 (Conflict)
```

---

## 현재 상태

### 데이터베이스 상태
- ✅ **프로젝트**: 생성됨 (`EventLive`, `ustudiopd`)
- ✅ **job_locks**: 재스캔 잠금 생성됨 (`rescan:ustudiopd/EventLive`)
- ❌ **ingestion_runs**: **비어있음** (실행 기록 없음)
- ❌ **scan_progress**: **비어있음** (진행 상태 없음)
- ❌ **repo_files**: **0개** (파일 인덱싱 안 됨)

### UI 상태
- ✅ SSE 연결: 성공 ("실시간" 표시)
- ❌ 진행 상태: 모두 0 (0/0, 0 청크, 0/3)
- ❌ 파일 목록: 비어있음

---

## 문제 분석

### 근본 원인

1. **잠금은 생성되지만 실제 작업이 실행되지 않음**
   - `claim_job` RPC는 성공하여 잠금 생성
   - 하지만 `runInitialScan` 함수가 실행되지 않거나 즉시 실패
   - 결과적으로 `ingestion_runs` 테이블에 레코드가 생성되지 않음

2. **비동기 실행으로 인한 에러 추적 어려움**
   - `runInitialScan`은 `.catch()`로만 에러 처리
   - 에러가 발생해도 사용자에게 피드백 없음
   - 서버 콘솔에만 로그가 남음

3. **잠금 해제 로직의 타이밍 문제**
   - 재스캔 API에서 `ingestion_runs`가 없으면 잠금을 삭제하도록 수정했지만
   - `claim_job` RPC 호출 전에 잠금을 삭제해도, RPC 내부에서 다시 잠금을 생성할 수 있음
   - 또는 다른 프로세스가 동시에 잠금을 생성할 수 있음

### 가능한 원인들

#### 1. GitHub API 접근 문제
- **가능성**: 높음
- **증상**: `getRepositoryTree` 호출 시 에러 발생
- **확인 방법**: 서버 콘솔 로그 확인
- **해결**: GitHub Access Token 유효성 확인, 리포지토리 접근 권한 확인

#### 2. 브랜치 이름 문제
- **가능성**: 중간
- **증상**: 기본 브랜치가 'main'이 아닌 경우 (예: 'master', 'develop')
- **상태**: ✅ 수정 완료 (동적 브랜치 감지 추가)
- **확인**: `lib/github.ts`에서 기본 브랜치 자동 감지 로직 추가됨

#### 3. runInitialScan 실행 실패
- **가능성**: 높음
- **증상**: 함수 시작 시점에서 에러 발생 (예: ingestion_runs 생성 실패)
- **확인 방법**: 서버 콘솔에서 `Starting initial scan for project...` 로그 확인
- **가능한 에러**:
  - RLS 정책 문제로 `ingestion_runs` 삽입 실패
  - Supabase 연결 문제
  - 권한 문제

#### 4. 비동기 실행 타이밍 문제
- **가능성**: 중간
- **증상**: `runInitialScan`이 호출되기 전에 API가 응답 반환
- **확인**: 코드상으로는 정상적으로 비동기 실행됨

---

## 재현 단계

1. 프로젝트 상세 페이지 접속 (`/dashboard/projects/:id`)
2. 우측 상단 "🔄 재스캔" 버튼 클릭
3. **결과**: 409 Conflict 에러 발생
4. **확인**: `ingestion_runs` 테이블에 레코드 없음

---

## 시도한 해결 방법

### ✅ 완료된 수정
1. **재스캔 API 개선**: `ingestion_runs`가 없으면 잠금을 자동으로 삭제하도록 수정
2. **브랜치 자동 감지**: `getRepositoryTree`가 기본 브랜치를 동적으로 가져오도록 수정
3. **에러 처리 개선**: 재스캔 실패 시 `ingestion_runs`에 실패 상태 기록
4. **자동 재스캔 제거**: 페이지 로드 시 자동 재스캔 로직 제거 (409 에러 방지)

### ⚠️ 부분 해결
- 잠금 해제: 수동으로 잠금을 삭제했지만, 재스캔 버튼 클릭 시 다시 잠금 생성됨

---

## 권장 해결 방안

### 즉시 조치 (긴급)

#### 1. 서버 로그 확인
```bash
# Next.js 개발 서버 콘솔에서 다음 로그 확인:
- "Starting initial scan for project..."
- "Error creating ingestion run:"
- "Error in initial scan for project:"
- GitHub API 관련 에러 메시지
```

#### 2. 재스캔 API 로직 개선
**문제**: `ingestion_runs` 확인 후 잠금 삭제하는 로직이 `claim_job` 호출 전에 실행되어도, RPC 내부에서 다시 잠금을 생성할 수 있음

**해결 방안**:
```typescript
// ingestion_runs가 없으면 잠금을 먼저 삭제
if (!activeRun) {
  await supabaseAdmin
    .from('job_locks')
    .delete()
    .eq('job_name', jobName);
}

// 잠시 대기 (동시성 문제 방지)
await new Promise(resolve => setTimeout(resolve, 100));

// 그 다음 claim_job 호출
const { data: claimResult, error: claimError } = await supabaseAdmin.rpc(
  'claim_job',
  { p_job_name: jobName, p_duration: '1 hour' }
);
```

#### 3. runInitialScan 동기 실행 옵션 추가
**문제**: 비동기 실행으로 에러 추적이 어려움

**해결 방안**: 
- 재스캔 API에서 `runInitialScan`을 동기적으로 실행하거나
- 최소한 `ingestion_runs` 생성까지는 동기적으로 확인

### 중기 조치 (1-2일)

#### 4. 에러 로깅 시스템 구축
- 구조화된 에러 로깅 테이블 생성
- 에러 발생 시 사용자에게 알림 표시
- 재스캔 실패 시 자동 재시도 메커니즘

#### 5. 재스캔 API 응답 개선
- 재스캔 시작 여부를 명확히 반환
- `ingestion_runs` ID를 반환하여 프론트엔드에서 추적 가능하도록

#### 6. 디버깅 도구 추가
- 재스캔 상태 확인 API (`GET /api/projects/:id/rescan/status`)
- 최근 실행 로그 조회 API

---

## 즉시 확인 필요 사항

### 1. 서버 콘솔 로그
재스캔 버튼 클릭 후 서버 콘솔에서 다음을 확인:

```
[ ] "Starting initial scan for project a535134d-ccbc-41d5-a848-037a8e0d2140"
[ ] "Error creating ingestion run: ..."
[ ] GitHub API 관련 에러
[ ] 기타 에러 메시지
```

### 2. 데이터베이스 직접 확인
```sql
-- 최신 ingestion_runs 확인
SELECT * FROM vibememory.ingestion_runs 
WHERE project_id = 'a535134d-ccbc-41d5-a848-037a8e0d2140'
ORDER BY created_at DESC LIMIT 5;

-- job_locks 확인
SELECT * FROM vibememory.job_locks 
WHERE job_name LIKE '%EventLive%';
```

### 3. GitHub Access Token 확인
- 환경 변수 `SYSTEM_GITHUB_ACCESS_TOKEN` 설정 확인
- 토큰이 유효한지 확인
- 리포지토리 접근 권한 확인

---

## 예상되는 해결 시나리오

### 시나리오 1: GitHub API 에러
**증상**: 서버 콘솔에 GitHub API 관련 에러
**해결**: 
- Access Token 재발급
- 리포지토리 접근 권한 확인
- GitHub API 레이트 리밋 확인

### 시나리오 2: RLS 정책 문제
**증상**: `ingestion_runs` 삽입 실패
**해결**: 
- RLS 정책 확인 및 수정
- `supabaseAdmin` 사용 확인 (서비스 롤 키)

### 시나리오 3: 브랜치 문제
**증상**: `getRepositoryTree`에서 브랜치를 찾을 수 없음
**해결**: ✅ 이미 수정 완료 (동적 브랜치 감지)

### 시나리오 4: 비동기 실행 타이밍
**증상**: `runInitialScan`이 호출되지 않음
**해결**: 
- 동기 실행으로 변경 또는
- `ingestion_runs` 생성까지 동기적으로 확인

---

## 다음 단계

1. **즉시**: 서버 콘솔 로그 확인 및 공유
2. **즉시**: 재스캔 API 로직 개선 (잠금 삭제 타이밍 수정)
3. **단기**: 에러 로깅 시스템 구축
4. **단기**: 재스캔 상태 확인 API 추가

---

## 관련 파일

- `app/api/projects/[id]/rescan/route.ts` - 재스캔 API
- `lib/runInitialScan.ts` - 초기 스캔 로직
- `lib/github.ts` - GitHub API 클라이언트
- `components/ProgressBanner.tsx` - 진행 상태 UI
- `app/dashboard/projects/[id]/page.tsx` - 프로젝트 상세 페이지

---

## 추가 정보

- **프로젝트 ID**: `a535134d-ccbc-41d5-a848-037a8e0d2140`
- **리포지토리**: `ustudiopd/EventLive`
- **에러 발생 시점**: 재스캔 버튼 클릭 시
- **에러 코드**: 409 Conflict
- **에러 위치**: `app/api/projects/[id]/rescan/route.ts:80-84`

