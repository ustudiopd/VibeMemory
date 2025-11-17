# GPT-4.1-mini → GPT-5-mini 마이그레이션 가이드

## 📋 개요

이 문서는 GPT-4.1-mini에서 GPT-5-mini로 모델을 변경할 때 발생할 수 있는 **무응답 문제**를 해결하기 위한 가이드입니다.

## ⚠️ 주요 문제: 무응답 현상

### 증상
- API 호출은 성공하지만 응답 내용(`content`)이 비어있음
- 토큰은 사용되지만 실제 응답 텍스트가 없음
- `finish_reason`이 `length`로 표시됨

### 발생 조건
- `max_completion_tokens` 파라미터를 사용한 경우
- 모든 토큰이 `reasoning_tokens`로 사용되어 실제 응답이 생성되지 않음

## 🔍 원인 분석

### GPT-5-mini의 특성
1. **Reasoning 모델**: GPT-5-mini는 내부 추론 과정을 거치는 reasoning 모델입니다
2. **파라미터 차이**: 
   - GPT-4.1-mini: `max_tokens` 파라미터 사용 가능
   - GPT-5-mini: `max_tokens` 미지원, `max_completion_tokens` 사용 필요
3. **Reasoning 모드 전환**: `max_completion_tokens`를 명시하면 reasoning 모드로 전환되어 모든 토큰이 내부 추론에 사용됨

### 테스트 결과

#### ❌ 문제 발생 케이스
```python
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "안녕하세요!"}],
    max_completion_tokens=100  # ❌ 이 파라미터가 문제!
)

# 결과:
# - content: '' (비어있음)
# - reasoning_tokens: 100
# - completion_tokens: 0
```

#### ✅ 정상 작동 케이스
```python
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "안녕하세요!"}]
    # max_completion_tokens 파라미터 없음
)

# 결과:
# - content: '안녕하세요! 만나서 반가워요...' (정상 응답)
# - reasoning_tokens: 0 또는 적은 수
# - completion_tokens: 정상 값
```

## ✅ 해결 방법

### 1. max_completion_tokens 파라미터 제거

**변경 전 (GPT-4.1-mini):**
```python
response = client.chat.completions.create(
    model="gpt-4.1-mini",
    messages=[{"role": "user", "content": "질문"}],
    max_tokens=100  # GPT-4.1-mini에서는 사용 가능
)
```

**변경 후 (GPT-5-mini):**
```python
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "질문"}]
    # max_completion_tokens 제거!
)
```

### 2. 토큰 제한이 필요한 경우

GPT-5-mini에서 토큰 제한이 꼭 필요한 경우, 다음과 같은 대안을 고려하세요:

#### 방법 1: 응답 후 처리
```python
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "질문"}]
)

content = response.choices[0].message.content
# 필요시 클라이언트 측에서 길이 제한
if len(content) > 500:
    content = content[:500] + "..."
```

#### 방법 2: 프롬프트에 제한 요청
```python
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{
        "role": "user", 
        "content": "질문 (답변은 100단어 이내로 작성해주세요)"
    }]
)
```

### 3. 스트리밍 방식 사용

스트리밍을 사용하는 경우에도 동일한 주의사항이 적용됩니다:

```python
stream = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "질문"}],
    stream=True
    # max_completion_tokens 제거!
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end='')
```

## 🔄 마이그레이션 체크리스트

프로젝트에서 GPT-4.1-mini를 GPT-5-mini로 변경할 때 다음 사항을 확인하세요:

- [ ] 모델 이름 변경: `gpt-4.1-mini` → `gpt-5-mini`
- [ ] `max_tokens` 파라미터 제거 또는 `max_completion_tokens`로 변경
- [ ] **`max_completion_tokens` 파라미터 제거** (무응답 방지)
- [ ] 응답 처리 로직 확인 (빈 응답 체크 추가)
- [ ] 토큰 사용량 모니터링 (reasoning_tokens 포함)
- [ ] 테스트: 실제 API 호출로 응답 확인

## 📝 코드 예시: 완전한 마이그레이션

### Before (GPT-4.1-mini)
```python
from openai import OpenAI

client = OpenAI(api_key=api_key)

response = client.chat.completions.create(
    model="gpt-4.1-mini",
    messages=[
        {"role": "user", "content": "안녕하세요! 간단히 자기소개를 해주세요."}
    ],
    max_tokens=100
)

content = response.choices[0].message.content
print(content)
```

### After (GPT-5-mini)
```python
from openai import OpenAI

client = OpenAI(api_key=api_key)

response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[
        {"role": "user", "content": "안녕하세요! 간단히 자기소개를 해주세요."}
    ]
    # max_tokens 또는 max_completion_tokens 제거
)

content = response.choices[0].message.content

# 빈 응답 체크 추가 (안전장치)
if not content:
    print("⚠️ 응답이 비어있습니다. max_completion_tokens 파라미터를 확인하세요.")
else:
    print(content)
```

## 🧪 테스트 방법

마이그레이션 후 다음 테스트를 수행하세요:

```python
def test_gpt5_mini():
    """GPT-5-mini 응답 테스트"""
    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[{"role": "user", "content": "안녕하세요!"}]
    )
    
    content = response.choices[0].message.content
    
    # 응답 확인
    assert content, "응답이 비어있습니다!"
    assert len(content) > 0, "응답 길이가 0입니다!"
    
    print(f"✅ 응답 성공: {content[:50]}...")
    print(f"토큰 사용량: {response.usage.total_tokens}")
    
    return content
```

## 📊 토큰 사용량 이해

GPT-5-mini는 reasoning 모델이므로 토큰 사용량 구조가 다릅니다:

```python
usage = response.usage
print(f"총 토큰: {usage.total_tokens}")
print(f"입력 토큰: {usage.prompt_tokens}")
print(f"출력 토큰: {usage.completion_tokens}")

# GPT-5-mini 특화 정보
if hasattr(usage, 'completion_tokens_details'):
    details = usage.completion_tokens_details
    if hasattr(details, 'reasoning_tokens'):
        print(f"Reasoning 토큰: {details.reasoning_tokens}")
```

**주의**: `reasoning_tokens`가 높더라도 실제 응답(`content`)이 비어있으면 `max_completion_tokens` 파라미터 사용을 의심하세요.

## 🚨 주의사항

1. **절대 사용하지 말 것**: `max_completion_tokens` 파라미터 (무응답 원인)
2. **환경 변수 확인**: `.env` 파일에서 모델 이름이 올바르게 변경되었는지 확인
3. **에러 처리**: 빈 응답에 대한 예외 처리 추가
4. **비용**: reasoning 모델이므로 토큰 사용량이 다를 수 있음

## 📚 참고 자료

- OpenAI API 문서: [Chat Completions](https://platform.openai.com/docs/api-reference/chat)
- 테스트 스크립트: `test_gpt_api.py` 참조

## 🔗 관련 파일

- `test_gpt_api.py`: GPT-5-mini API 테스트 스크립트
- `.env.local`: API 키 및 모델 설정

---

**작성일**: 2025-01-XX  
**테스트 환경**: Python 3.12, openai>=1.0.0  
**검증 완료**: ✅

