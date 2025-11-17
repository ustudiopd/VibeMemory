# 웹훅 큐 PGRST106 에러 분석 리포트

## 📋 에러 개요

**에러 코드**: `PGRST106`  
**에러 메시지**: `The schema must be one of the following: public, graphql_public`  
**발생 위치**: `/api/cron/process-webhook-jobs`  
**발생 시간**: 2025-11-17 19:55 ~ 19:59 (지속적)

## 🔍 에러 상세 분석

### 1. 에러 발생 흐름

```
1. GitHub Push 이벤트 발생
   ↓
2. /api/github/webhook 수신 (✅ 성공)
   - Job queued successfully
   - deliveryId: '8bb43a30-c3a4-11f0-834e-2eb858125e96'
   ↓
3. /api/cron/process-webhook-jobs 실행 (❌ 실패)
   - PGRST106 에러 발생
   - "The schema must be one of the following: public, graphql_public"
```

### 2. 에러 원인

**핵심 문제**: PostgREST가 `vibememory` 스키마에 대한 접근을 허용하지 않음

**상세 원인**:
1. **테이블 위치**: `vibememory.webhook_jobs` (마이그레이션으로 생성됨)
2. **PostgREST 제한**: Supabase PostgREST는 기본적으로 `public`과 `graphql_public` 스키마만 노출
3. **코드 시도**: `.schema('vibememory')` 사용 시도 (하지만 실제로는 적용되지 않았거나, 적용되었지만 PostgREST가 거부)
4. **결과**: `vibememory` 스키마 접근 시도 → PostgREST가 `PGRST106` 에러 반환

### 3. 현재 상태 확인

#### 테이블 위치
- ✅ `vibememory.webhook_jobs`: 생성됨 (마이그레이션 확인)
- ✅ `vibememory.webhook_deliveries`: 생성됨 (마이그레이션 확인)
- ✅ `public.webhook_jobs`: 생성됨 (이전 마이그레이션)
- ✅ `public.webhook_deliveries`: 생성됨 (이전 마이그레이션)

#### 코드 상태
- ❌ `app/api/cron/process-webhook-jobs/route.ts`: 스키마 명시 없음 또는 잘못된 스키마 사용
- ❌ `app/api/github/webhook/route.ts`: 스키마 명시 없음

## 🚨 문제점 정리

### 문제 1: 스키마 접근 제한
- **현상**: PostgREST가 `vibememory` 스키마 접근 거부
- **원인**: Supabase PostgREST 기본 설정은 `public`, `graphql_public`만 허용
- **영향**: `vibememory` 스키마의 테이블에 직접 접근 불가

### 문제 2: 테이블 중복
- **현상**: `public`과 `vibememory` 스키마 모두에 테이블 존재
- **원인**: 마이그레이션을 여러 번 실행하여 양쪽에 생성됨
- **영향**: 데이터 일관성 문제 가능성

### 문제 3: 코드 스키마 명시 불일치
- **현상**: 코드에서 스키마를 명시하지 않거나 잘못된 스키마 사용
- **원인**: `해결책.md` 권장사항과 실제 구현 불일치
- **영향**: 예상치 못한 스키마 접근 시도

## 💡 해결 방안

### 방안 1: `public` 스키마 사용 (권장 - 즉시 적용 가능)

**장점**:
- PostgREST 기본 지원
- 추가 설정 불필요
- 즉시 작동

**단점**:
- 다른 테이블들(`job_locks` 등)과 스키마 불일치
- `해결책.md` 권장사항과 다름

**구현**:
1. `vibememory` 스키마 테이블 삭제 (선택)
2. `public` 스키마 테이블 사용
3. 코드에서 스키마 명시 제거 (기본 `public` 사용)

### 방안 2: PostgREST에 `vibememory` 스키마 노출 (권장 - 장기적)

**장점**:
- 다른 테이블들과 스키마 일관성
- `해결책.md` 권장사항 준수
- 확장성 좋음

**단점**:
- Supabase 설정 변경 필요
- 추가 작업 필요

**구현**:
1. Supabase Dashboard → Settings → API → Extra Search Path 설정
2. `vibememory` 스키마를 검색 경로에 추가
3. 또는 `db.extra_search_path` 설정 사용

### 방안 3: RPC 함수 사용 (권장 - 안정적)

**장점**:
- 스키마 제한 우회
- 원자적 작업 보장
- `job_locks`와 동일한 패턴

**단점**:
- RPC 함수 추가 개발 필요
- 코드 복잡도 증가

**구현**:
1. `vibememory.claim_webhook_jobs()` RPC 함수 생성
2. 워커에서 RPC 함수 호출
3. 직접 테이블 접근 대신 RPC 사용

## 📊 우선순위별 해결 계획

### 🔴 즉시 적용 (방안 1)

1. **코드 수정**: 모든 `webhook_jobs`, `webhook_deliveries` 접근을 `public` 스키마로 통일
   - `app/api/cron/process-webhook-jobs/route.ts`
   - `app/api/github/webhook/route.ts`
   - 스키마 명시 제거 (기본 `public` 사용)

2. **테이블 정리**: `vibememory` 스키마 테이블 삭제 (선택)
   - 데이터 마이그레이션 확인 후 삭제

3. **테스트**: 웹훅 수신 → 워커 처리 확인

### 🟡 중기 개선 (방안 2 또는 3)

1. **PostgREST 설정 변경** 또는 **RPC 함수 구현**
2. **스키마 일관성 확보**
3. **원자적 클레임 구현**

## 🔧 즉시 적용 가능한 수정 코드

### 수정 1: 워커 라우트 (`app/api/cron/process-webhook-jobs/route.ts`)

```typescript
// 현재 (에러 발생)
const { data: jobs, error: fetchError } = await supabaseAdmin
  .schema('vibememory')  // ❌ PGRST106 에러
  .from('webhook_jobs')
  .select('*')
  .eq('status', 'pending')

// 수정 후 (public 스키마 사용)
const { data: jobs, error: fetchError } = await supabaseAdmin
  .from('webhook_jobs')  // ✅ 기본 public 스키마
  .select('*')
  .eq('status', 'pending')
```

### 수정 2: 웹훅 라우트 (`app/api/github/webhook/route.ts`)

```typescript
// 모든 webhook_jobs, webhook_deliveries 접근에서
// .schema('vibememory') 제거 (기본 public 사용)
```

## 📝 체크리스트

### 즉시 수정 필요
- [ ] `app/api/cron/process-webhook-jobs/route.ts`: 모든 `.schema('vibememory')` 제거
- [ ] `app/api/github/webhook/route.ts`: 모든 `.schema('vibememory')` 제거
- [ ] 빌드 및 배포
- [ ] 웹훅 테스트

### 선택적 정리
- [ ] `vibememory.webhook_jobs` 테이블 삭제 (데이터 확인 후)
- [ ] `vibememory.webhook_deliveries` 테이블 삭제 (데이터 확인 후)

### 향후 개선
- [ ] PostgREST 설정 변경 또는 RPC 함수 구현
- [ ] 원자적 클레임 RPC 함수 추가
- [ ] CRON_SECRET 검증 강화

## 🎯 예상 결과

### 즉시 수정 후
- ✅ `PGRST106` 에러 해결
- ✅ 웹훅 작업 큐 정상 처리
- ✅ 파일 업로드 정상 작동 (한글 파일명 포함)

### 장기 개선 후
- ✅ 스키마 일관성 확보
- ✅ 원자적 클레임으로 경합 조건 방지
- ✅ 보안 강화

## 📌 참고사항

1. **PostgREST 스키마 제한**: Supabase PostgREST는 기본적으로 `public`과 `graphql_public`만 노출합니다. 다른 스키마 접근은 설정 변경 또는 RPC 함수를 통해야 합니다.

2. **기존 패턴**: `job_locks` 테이블도 `vibememory` 스키마에 있지만, RPC 함수(`claim_job`, `force_claim_job`)를 통해 접근하고 있습니다.

3. **해결책.md 권장사항**: `vibememory` 스키마 사용을 권장하지만, PostgREST 설정 변경 없이는 직접 접근이 불가능합니다.

## 🔗 관련 문서

- `해결책.md`: 웹훅 큐 해결 방안
- `해결책_검토_리포트_웹훅큐.md`: 이전 검토 리포트
- `Vercel_웹훅_연동_종합_보고서.md`: 웹훅 연동 상세 문서

