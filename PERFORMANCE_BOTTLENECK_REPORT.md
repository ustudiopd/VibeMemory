# 파일 스캔 및 다운로드 성능 병목 분석 리포트

**작성일**: 2025-11-15  
**분석 대상**: `lib/runInitialScan.ts`, `lib/github.ts`, `lib/storage.ts`, `lib/rag.ts`

---

## 📊 실행 흐름 분석

### 현재 프로세스 (순차 처리)

```
1. getRepositoryTree() - GitHub API 호출 (1회)
   ↓
2. for each file (순차 처리):
   ├─ getFileContent() - GitHub API 호출 (N회)
   ├─ uploadFileToStorage() - Supabase Storage 업로드 (N회)
   ├─ DB INSERT (repo_files) - Supabase DB 쿼리 (N회)
   ├─ updateScanProgress() - Supabase DB 쿼리 (N회)
   ├─ chunkText() - 메모리 내 처리
   ├─ embedChunks() - OpenAI API 호출 (청크 수만큼)
   ├─ insert_repo_file_chunks() RPC - Supabase DB 쿼리 (N회)
   └─ updateScanProgress() - Supabase DB 쿼리 (N회)
   ↓
3. analyzeProject() - AI 분석 (4단계)
```

---

## 🔴 주요 병목 지점

### 1. **순차 처리 (Sequential Processing)**
**위치**: `lib/runInitialScan.ts:170-262`

**문제점**:
- 모든 파일을 `for` 루프로 순차 처리
- 파일 1개 처리 완료 후 다음 파일 시작
- 병렬 처리 불가능

**영향**:
- 7개 파일 처리 시: `7 × (평균 처리 시간)` = 총 처리 시간
- 각 파일당 약 10-30초 소요 시 → 70-210초

**코드 예시**:
```typescript
// 현재: 순차 처리
for (const item of mdFiles) {
  const content = await getFileContent(...);  // 대기
  await uploadFileToStorage(...);              // 대기
  await supabaseAdmin.from('repo_files').insert(...);  // 대기
  // ...
}
```

---

### 2. **GitHub API 호출 지연**
**위치**: `lib/github.ts:110-128`, `lib/runInitialScan.ts:175`

**문제점**:
- 각 파일마다 개별 API 호출 (`getFileContent`)
- GitHub API Rate Limit: 5,000 requests/hour (인증된 사용자)
- 네트워크 지연: 각 호출당 200-500ms
- 순차 호출로 인한 누적 지연

**영향**:
- 7개 파일 × 300ms = 2.1초 (최소)
- 실제로는 재시도, 에러 처리 등으로 더 오래 걸림

**개선 방안**:
- 병렬 처리: `Promise.all()` 사용
- 배치 API 사용 (가능한 경우)
- 캐싱: 동일 SHA 파일 재다운로드 방지

---

### 3. **Supabase Storage 업로드 지연**
**위치**: `lib/storage.ts:48-87`, `lib/runInitialScan.ts:179`

**문제점**:
- 각 파일마다 개별 업로드
- 버킷 존재 확인을 매번 수행 (`ensureBucketExists`)
- 네트워크 지연: 각 업로드당 200-1000ms
- 순차 업로드로 인한 누적 지연

**영향**:
- 7개 파일 × 500ms = 3.5초 (최소)
- 버킷 확인 오버헤드 추가

**코드 문제점**:
```typescript
// 매번 버킷 확인 (비효율)
async function ensureBucketExists() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  // ...
}

// 각 파일마다 호출
for (const item of mdFiles) {
  await uploadFileToStorage(...);  // 내부에서 ensureBucketExists() 호출
}
```

**개선 방안**:
- 버킷 확인을 한 번만 수행 (초기화 시)
- 병렬 업로드: `Promise.all()` 사용
- 업로드 실패 시 재시도 로직 추가

---

### 4. **OpenAI 임베딩 API 호출 지연**
**위치**: `lib/rag.ts:77-87`, `lib/runInitialScan.ts:227`

**현재 상태**:
- ✅ **이미 배치 처리 구현됨**: `embedChunks()` 함수가 여러 청크를 한 번에 처리
- 각 파일의 모든 청크를 한 번의 API 호출로 처리

**남은 문제점**:
- 각 파일마다 순차적으로 임베딩 호출
- 파일당 1회 API 호출이지만, 순차 처리로 인한 누적 지연
- OpenAI API Rate Limit 및 지연 (각 호출당 500-2000ms)

**영향**:
- 파일당 평균 3-5개 청크
- 7개 파일 × 1회 호출 = 7회 임베딩 요청
- 각 요청당 1000ms (평균) → 7초

**개선 방안**:
- ✅ 배치 임베딩: 이미 구현됨
- 병렬 처리: 여러 파일의 임베딩을 동시에 처리
- 캐싱: 동일 내용 재임베딩 방지

---

### 5. **데이터베이스 쿼리 오버헤드**
**위치**: `lib/runInitialScan.ts` (여러 위치)

**문제점**:
- 각 파일마다 여러 번의 DB 쿼리:
  - `repo_files` INSERT (1회)
  - `updateScanProgress` (2회: md_indexed, chunk_total)
  - `repo_file_chunks` UPDATE (1회: is_current = false)
  - `insert_repo_file_chunks` RPC (1회)
- 순차 쿼리로 인한 누적 지연
- 각 쿼리당 50-200ms

**영향**:
- 파일당 약 5-6회 쿼리
- 7개 파일 × 6회 × 100ms = 4.2초

**개선 방안**:
- 배치 INSERT: 여러 파일을 한 번에 삽입
- 트랜잭션 사용: 여러 쿼리를 하나로 묶기
- 진행 상태 업데이트 빈도 감소 (매 파일마다가 아닌 주기적으로)

---

### 6. **진행 상태 업데이트 빈도**
**위치**: `lib/runInitialScan.ts:207-209, 253-255`

**문제점**:
- 각 파일 처리 후마다 `updateScanProgress` 호출
- 불필요한 DB 쿼리 증가
- 사용자 경험 개선 효과는 미미 (실시간 업데이트 불필요)

**영향**:
- 파일당 2회 추가 쿼리
- 7개 파일 × 2회 × 100ms = 1.4초

**개선 방안**:
- 주기적 업데이트: 3-5개 파일마다 한 번
- 또는 완료 후 한 번만 업데이트

---

### 7. **에러 처리 및 재시도 부재**
**위치**: 전체 프로세스

**문제점**:
- 네트워크 오류 시 전체 프로세스 실패
- 재시도 로직 없음
- 부분 실패 시 복구 불가능

**영향**:
- 일시적 오류로 인한 전체 재실행 필요
- 시간 낭비 증가

---

## 📈 성능 개선 시뮬레이션

### 현재 성능 (순차 처리)
```
파일 수: 7개
파일당 처리 시간: 15초 (평균)
총 처리 시간: 7 × 15 = 105초 (약 1분 45초)
```

### 병렬 처리 적용 시 (이론적)
```
파일 수: 7개
병렬 처리: 3개씩 동시 처리
파일당 처리 시간: 15초
총 처리 시간: (7 ÷ 3) × 15 = 약 35초
개선율: 66% 감소
```

### 최적화 적용 시 (이론적)
```
- 병렬 처리: 3개씩 동시
- ✅ 배치 임베딩: 이미 구현됨 (파일당 1회 호출)
- DB 배치 INSERT: 여러 파일 한 번에
- 진행 상태 업데이트: 5개마다 1회

예상 총 처리 시간: 약 20-25초
개선율: 80% 감소
```

---

## 🎯 우선순위별 개선 방안

### 🔴 긴급 (High Impact, Low Effort)

1. **병렬 처리 도입**
   - `Promise.all()` 또는 `Promise.allSettled()` 사용
   - 동시 처리 수 제한 (3-5개)
   - 예상 개선: 50-70% 시간 단축

2. **버킷 확인 최적화**
   - 초기화 시 한 번만 확인
   - 캐싱하여 재확인 방지
   - 예상 개선: 1-2초 단축

3. **진행 상태 업데이트 빈도 감소**
   - 3-5개 파일마다 한 번
   - 예상 개선: 1-2초 단축

### 🟡 중요 (High Impact, Medium Effort)

4. **임베딩 병렬 처리**
   - 여러 파일의 임베딩을 동시에 처리
   - ✅ 배치 임베딩은 이미 구현됨 (파일 내 청크들)
   - 예상 개선: 20-30% 시간 단축

5. **DB 배치 INSERT**
   - 여러 파일을 한 번에 삽입
   - 트랜잭션 사용
   - 예상 개선: 2-4초 단축

6. **에러 처리 및 재시도**
   - 개별 파일 실패 시에도 계속 진행
   - 재시도 로직 추가
   - 예상 개선: 안정성 향상

### 🟢 선택적 (Medium Impact, High Effort)

7. **캐싱 전략**
   - 동일 SHA 파일 재다운로드 방지
   - 임베딩 결과 캐싱
   - 예상 개선: 재실행 시 시간 단축

8. **워커 큐 시스템**
   - 백그라운드 작업 큐
   - 우선순위 관리
   - 예상 개선: 시스템 부하 분산

---

## 📝 구체적 개선 코드 예시

### 1. 병렬 처리 도입

```typescript
// 현재 (순차)
for (const item of mdFiles) {
  await processFile(item);
}

// 개선 (병렬, 동시 3개)
const BATCH_SIZE = 3;
for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
  const batch = mdFiles.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(item => processFile(item)));
}
```

### 2. 버킷 확인 최적화

```typescript
// 현재 (매번 확인)
async function uploadFileToStorage(...) {
  await ensureBucketExists();  // 매번 호출
  // ...
}

// 개선 (한 번만 확인)
let bucketChecked = false;
async function uploadFileToStorage(...) {
  if (!bucketChecked) {
    await ensureBucketExists();
    bucketChecked = true;
  }
  // ...
}
```

### 3. 진행 상태 업데이트 최적화

```typescript
// 현재 (매 파일마다)
for (const item of mdFiles) {
  await processFile(item);
  await updateScanProgress(...);  // 매번 (2회: md_indexed, chunk_total)
}

// 개선 (주기적으로)
let processedCount = 0;
for (const item of mdFiles) {
  await processFile(item);
  processedCount++;
  if (processedCount % 5 === 0 || processedCount === mdFiles.length) {
    await updateScanProgress(...);  // 5개마다 또는 마지막
  }
}
```

### 4. 임베딩 병렬 처리 (추가 개선)

```typescript
// 현재: 각 파일의 임베딩이 순차 처리
for (const item of mdFiles) {
  const chunks = chunkText(content, item.path);
  const embeddings = await embedChunks(chunks);  // 순차 대기
}

// 개선: 여러 파일의 임베딩을 동시에 처리
const embeddingPromises = mdFiles.map(async (item) => {
  const chunks = chunkText(content, item.path);
  return await embedChunks(chunks);  // 병렬 처리
});
const allEmbeddings = await Promise.all(embeddingPromises);
```

---

## 🔍 추가 분석 필요 사항

1. **실제 측정 데이터 수집**
   - 각 단계별 소요 시간 측정
   - 네트워크 지연 분석
   - DB 쿼리 성능 분석

2. **리소스 사용량 모니터링**
   - 메모리 사용량
   - CPU 사용량
   - 네트워크 대역폭

3. **에러 발생 빈도 분석**
   - 실패한 요청 비율
   - 재시도 필요 빈도
   - 타임아웃 발생 빈도

---

## 📌 결론

현재 파일 스캔 및 다운로드 프로세스의 주요 병목은 **순차 처리**입니다. 병렬 처리만 도입해도 50-70%의 시간 단축이 가능하며, 추가 최적화를 통해 80% 이상의 개선이 기대됩니다.

**즉시 적용 가능한 개선**:
1. 병렬 처리 도입 (3-5개 동시)
2. 버킷 확인 최적화
3. 진행 상태 업데이트 빈도 감소

이 세 가지만 적용해도 **현재 대비 60-70% 시간 단축**이 가능합니다.

