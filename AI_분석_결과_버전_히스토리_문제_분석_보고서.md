# AI 분석 결과 버전 히스토리 로딩 문제 분석 보고서

## 📋 개요

**문제**: AI 분석 결과 탭의 "버전 히스토리" 섹션에서 커밋 히스토리를 불러오지 못하는 문제

**작성일**: 2025-01-16

**우선순위**: 🟡 중간 (High)

---

## 🔍 문제 현상

### 증상
1. AI 분석 결과 탭에서 "버전 히스토리" 섹션을 펼쳤을 때
2. "커밋 히스토리를 불러오는 중..." 메시지가 계속 표시되거나
3. "커밋 히스토리가 없습니다." 메시지가 표시됨
4. 실제로는 커밋이 존재하지만 표시되지 않음

### 영향 범위
- GitHub 프로젝트의 AI 분석 결과 탭
- 버전 히스토리 섹션만 영향 (다른 섹션은 정상 작동)

---

## 🔎 원인 분석

### 1. 데이터 소스 문제

#### 1.1 `commit_history` 테이블 데이터 부재
**위치**: `app/api/projects/[id]/commits/route.ts:42-47`

```typescript
const { data: savedCommits, error: commitsError } = await supabaseAdmin
  .from('commit_history')
  .select('*')
  .eq('project_id', projectId)
  .order('commit_date', { ascending: false })
  .limit(perPage);
```

**문제점**:
- API는 `commit_history` 테이블에서만 데이터를 조회함
- 이 테이블은 **웹훅 이벤트** 또는 **수동 동기화**를 통해서만 채워짐
- 프로젝트 임포트 시 커밋 히스토리가 자동으로 저장되지 않음

**데이터 흐름**:
1. ✅ 웹훅 수신 시 저장 (`app/api/github/webhook/route.ts:88-118`)
2. ✅ 수동 동기화 API 호출 시 저장 (`app/api/projects/[id]/commits/sync/route.ts:58-89`)
3. ❌ 프로젝트 임포트 시 저장 안 됨

### 2. 로딩 타이밍 문제

#### 2.1 초기 로드 시점
**위치**: `app/dashboard/projects/[id]/page.tsx:113-138`

```typescript
useEffect(() => {
  if (projectId) {
    loadProjectData();
  }
}, [projectId]);

const loadProjectData = async () => {
  // ...
  await Promise.all([
    fetchProject(),
    fetchProjectDetails(),
    fetchProgress(),
    fetchAnalysis(),
    fetchCommits(), // 여기서 호출
  ]);
  // ...
};
```

**문제점**:
- `fetchCommits`는 프로젝트 로드 시 한 번만 호출됨
- 버전 히스토리 섹션이 접혀있을 때도 데이터를 미리 로드함
- 하지만 데이터가 없을 경우 사용자가 알 수 없음

#### 2.2 에러 처리 부족
**위치**: `app/dashboard/projects/[id]/page.tsx:125-138`

```typescript
const fetchCommits = async () => {
  setLoadingCommits(true);
  try {
    const response = await fetch(`/api/projects/${projectId}/commits?per_page=30`);
    if (response.ok) {
      const data = await response.json();
      setCommits(data.commits || []);
    }
    // ⚠️ response.ok가 false일 때 처리 없음
  } catch (error) {
    console.error('Error fetching commits:', error);
    // ⚠️ 사용자에게 에러 표시 없음
  } finally {
    setLoadingCommits(false);
  }
};
```

**문제점**:
- API 호출 실패 시 사용자에게 피드백 없음
- 네트워크 오류, 인증 오류 등을 감지하지 못함
- `response.ok`가 false일 때도 조용히 실패함

### 3. UI 상태 관리 문제

#### 3.1 로딩 상태 표시
**위치**: `app/dashboard/projects/[id]/page.tsx:1144-1205`

```typescript
{expandedSections.versionHistory && (
  <div className="px-6 pb-6 pt-2">
    {loadingCommits ? (
      <div className="bg-white rounded-lg p-6 text-center mt-4">
        <p className="text-gray-500">커밋 히스토리를 불러오는 중...</p>
      </div>
    ) : commits.length > 0 ? (
      // 커밋 목록 표시
    ) : (
      <div className="bg-white rounded-lg p-6 text-center mt-4">
        <p className="text-gray-500">커밋 히스토리가 없습니다.</p>
      </div>
    )}
  </div>
)}
```

**문제점**:
- 데이터가 없을 때와 로딩 중일 때 구분이 명확하지 않음
- 사용자가 "데이터가 정말 없는지" vs "로딩 중인지" 구분 불가
- 재시도 버튼이나 동기화 버튼이 없음

### 4. 데이터 동기화 문제

#### 4.1 초기 데이터 부재
**문제점**:
- 프로젝트를 처음 임포트할 때 `commit_history` 테이블이 비어있음
- 웹훅이 설정되어 있어도, 과거 커밋은 저장되지 않음
- 사용자가 수동으로 동기화 API를 호출해야 함

#### 4.2 동기화 API 접근성
**위치**: `app/api/projects/[id]/commits/sync/route.ts`

**문제점**:
- 동기화 API가 존재하지만 UI에서 접근할 수 없음
- 사용자가 직접 API를 호출해야 함
- 버전 히스토리 섹션에 "동기화" 버튼이 없음

---

## 🎯 근본 원인 요약

1. **데이터 부재**: `commit_history` 테이블에 데이터가 없음
   - 프로젝트 임포트 시 커밋 히스토리가 자동 저장되지 않음
   - 웹훅은 미래 커밋만 저장 (과거 커밋은 저장 안 됨)

2. **에러 처리 부족**: API 호출 실패 시 사용자 피드백 없음
   - 네트워크 오류, 인증 오류 등을 감지하지 못함
   - 에러 메시지가 콘솔에만 출력됨

3. **사용자 액션 부재**: 데이터가 없을 때 사용자가 할 수 있는 액션이 없음
   - 동기화 버튼이 없음
   - 재시도 버튼이 없음

4. **로딩 타이밍**: 섹션을 펼칠 때 데이터를 다시 로드하지 않음
   - 초기 로드 시에만 데이터를 가져옴
   - 섹션을 펼칠 때 재시도하지 않음

---

## 💡 해결 방안

### 방안 1: 프로젝트 임포트 시 커밋 히스토리 자동 저장 (권장)

**장점**:
- 사용자 액션 불필요
- 프로젝트 임포트 시 즉시 버전 히스토리 사용 가능

**구현 방법**:
1. `app/api/projects/import/route.ts`에서 프로젝트 임포트 후
2. `getRepositoryCommits`를 호출하여 커밋 히스토리 가져오기
3. `commit_history` 테이블에 저장

**예상 작업 시간**: 2-3시간

### 방안 2: 버전 히스토리 섹션에 동기화 버튼 추가

**장점**:
- 사용자가 필요할 때 수동으로 동기화 가능
- 기존 프로젝트에도 적용 가능

**구현 방법**:
1. 버전 히스토리 섹션에 "동기화" 버튼 추가
2. 버튼 클릭 시 `/api/projects/[id]/commits/sync` API 호출
3. 동기화 완료 후 `fetchCommits` 재호출

**예상 작업 시간**: 1-2시간

### 방안 3: 섹션 펼칠 때 데이터 재로드

**장점**:
- 사용자가 섹션을 펼칠 때 최신 데이터 가져오기
- 간단한 구현

**구현 방법**:
1. `expandedSections.versionHistory`가 `true`로 변경될 때
2. `fetchCommits` 재호출
3. 데이터가 없으면 동기화 버튼 표시

**예상 작업 시간**: 1시간

### 방안 4: 에러 처리 및 사용자 피드백 개선

**장점**:
- 사용자가 문제를 인지할 수 있음
- 디버깅이 쉬워짐

**구현 방법**:
1. `fetchCommits`에서 에러 상태 추가
2. API 호출 실패 시 에러 메시지 표시
3. 재시도 버튼 추가

**예상 작업 시간**: 1시간

---

## 📝 권장 해결 순서

### Phase 1: 즉시 적용 (우선순위 높음)
1. ✅ **에러 처리 개선** (방안 4)
   - 사용자가 문제를 인지할 수 있도록 에러 메시지 표시
   - 재시도 버튼 추가

2. ✅ **동기화 버튼 추가** (방안 2)
   - 버전 히스토리 섹션에 "동기화" 버튼 추가
   - 사용자가 필요할 때 수동으로 동기화 가능

### Phase 2: 중기 개선 (우선순위 중간)
3. ✅ **섹션 펼칠 때 재로드** (방안 3)
   - 섹션을 펼칠 때 데이터를 다시 로드
   - 최신 데이터 보장

### Phase 3: 장기 개선 (우선순위 낮음)
4. ✅ **프로젝트 임포트 시 자동 저장** (방안 1)
   - 프로젝트 임포트 시 커밋 히스토리 자동 저장
   - 사용자 액션 불필요

---

## 🔧 구현 상세

### 1. 에러 처리 개선

**파일**: `app/dashboard/projects/[id]/page.tsx`

```typescript
const [commitsError, setCommitsError] = useState<string | null>(null);

const fetchCommits = async () => {
  setLoadingCommits(true);
  setCommitsError(null);
  try {
    const response = await fetch(`/api/projects/${projectId}/commits?per_page=30`);
    if (response.ok) {
      const data = await response.json();
      setCommits(data.commits || []);
    } else {
      const errorData = await response.json().catch(() => ({}));
      setCommitsError(errorData.error || '커밋 히스토리를 불러올 수 없습니다.');
    }
  } catch (error) {
    console.error('Error fetching commits:', error);
    setCommitsError('네트워크 오류가 발생했습니다.');
  } finally {
    setLoadingCommits(false);
  }
};
```

### 2. 동기화 버튼 추가

**파일**: `app/dashboard/projects/[id]/page.tsx`

```typescript
const [syncingCommits, setSyncingCommits] = useState(false);

const syncCommits = async () => {
  setSyncingCommits(true);
  try {
    const response = await fetch(`/api/projects/${projectId}/commits/sync`, {
      method: 'POST',
    });
    if (response.ok) {
      // 동기화 완료 후 커밋 목록 다시 가져오기
      await fetchCommits();
    } else {
      const errorData = await response.json().catch(() => ({}));
      alert(errorData.error || '동기화에 실패했습니다.');
    }
  } catch (error) {
    console.error('Error syncing commits:', error);
    alert('동기화 중 오류가 발생했습니다.');
  } finally {
    setSyncingCommits(false);
  }
};
```

**UI 추가**:
```typescript
{expandedSections.versionHistory && (
  <div className="px-6 pb-6 pt-2">
    {commitsError ? (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
        <p className="text-red-700 mb-2">{commitsError}</p>
        <button
          onClick={fetchCommits}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          재시도
        </button>
      </div>
    ) : loadingCommits ? (
      // 로딩 중...
    ) : commits.length > 0 ? (
      // 커밋 목록
    ) : (
      <div className="bg-white rounded-lg p-6 text-center mt-4">
        <p className="text-gray-500 mb-4">커밋 히스토리가 없습니다.</p>
        <button
          onClick={syncCommits}
          disabled={syncingCommits}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {syncingCommits ? '동기화 중...' : 'GitHub에서 동기화'}
        </button>
      </div>
    )}
  </div>
)}
```

### 3. 섹션 펼칠 때 재로드

**파일**: `app/dashboard/projects/[id]/page.tsx`

```typescript
useEffect(() => {
  if (expandedSections.versionHistory && commits.length === 0 && !loadingCommits) {
    fetchCommits();
  }
}, [expandedSections.versionHistory]);
```

---

## 📊 예상 효과

### 개선 전
- ❌ 버전 히스토리가 표시되지 않음
- ❌ 사용자가 문제를 인지하지 못함
- ❌ 해결 방법이 없음

### 개선 후
- ✅ 에러 발생 시 명확한 메시지 표시
- ✅ 동기화 버튼으로 수동 동기화 가능
- ✅ 재시도 버튼으로 간편한 재시도
- ✅ 섹션 펼칠 때 최신 데이터 로드

---

## 🧪 테스트 시나리오

### 시나리오 1: 데이터가 없는 경우
1. 버전 히스토리 섹션 펼치기
2. "커밋 히스토리가 없습니다." 메시지 확인
3. "GitHub에서 동기화" 버튼 클릭
4. 동기화 완료 후 커밋 목록 표시 확인

### 시나리오 2: API 호출 실패
1. 네트워크 오류 시뮬레이션
2. 에러 메시지 표시 확인
3. "재시도" 버튼 클릭
4. 재시도 후 성공 시 커밋 목록 표시 확인

### 시나리오 3: 섹션 펼칠 때 재로드
1. 버전 히스토리 섹션 접기
2. 새로운 커밋 생성 (GitHub에서)
3. 버전 히스토리 섹션 펼치기
4. 최신 커밋이 표시되는지 확인

---

## 📚 참고 자료

- `app/api/projects/[id]/commits/route.ts`: 커밋 히스토리 조회 API
- `app/api/projects/[id]/commits/sync/route.ts`: 커밋 히스토리 동기화 API
- `app/api/github/webhook/route.ts`: 웹훅에서 커밋 저장 로직
- `app/dashboard/projects/[id]/page.tsx`: 프로젝트 상세 페이지
- `lib/github.ts`: GitHub API 클라이언트

---

## ✅ 체크리스트

- [ ] 에러 처리 개선 (에러 상태 추가, 에러 메시지 표시)
- [ ] 동기화 버튼 추가 (UI 및 핸들러 구현)
- [ ] 재시도 버튼 추가
- [ ] 섹션 펼칠 때 재로드 로직 추가
- [ ] 테스트 시나리오 검증
- [ ] 사용자 피드백 수집

---

**작성자**: AI Assistant  
**검토 필요**: 개발팀 리뷰  
**다음 단계**: Phase 1 구현 시작


