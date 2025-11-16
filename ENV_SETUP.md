# 환경 변수 설정 가이드

서버가 정상적으로 작동하려면 `.env.local` 파일에 다음 환경 변수들을 설정해야 합니다.

## 필수 환경 변수

### 1. Supabase 설정

```env
NEXT_PUBLIC_SUPABASE_URL=https://xiygbsaewuqocaxoxeqn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**설정 방법:**
1. [Supabase Dashboard](https://supabase.com/dashboard)에 로그인
2. 프로젝트 선택 (`xiygbsaewuqocaxoxeqn`)
3. Settings → API에서 키 확인
   - `NEXT_PUBLIC_SUPABASE_URL`: Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: `anon` `public` 키
   - `SUPABASE_SERVICE_ROLE_KEY`: `service_role` `secret` 키 (⚠️ 절대 공개하지 마세요!)

### 2. GitHub OAuth 설정

```env
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

**설정 방법:**
1. [GitHub Developer Settings](https://github.com/settings/developers) 접속
2. "New OAuth App" 클릭
3. 다음 정보 입력:
   - **Application name**: VibeMemory (또는 원하는 이름)
   - **Homepage URL**: `http://localhost:3000` (개발) 또는 프로덕션 URL
   - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`
4. 생성 후 `Client ID`와 `Client Secret` 복사
5. Webhook Secret은 나중에 GitHub Webhook 설정 시 생성

### 3. NextAuth 설정

```env
NEXTAUTH_SECRET=your-random-secret-key
NEXTAUTH_URL=http://localhost:3000
```

**설정 방법:**
- `NEXTAUTH_SECRET`: 랜덤 문자열 생성 (예: `openssl rand -base64 32`)
- `NEXTAUTH_URL`: 개발 환경은 `http://localhost:3000`, 프로덕션은 실제 도메인

### 4. OpenAI 설정

```env
OPENAI_API_KEY=sk-your-openai-api-key
CHATGPT_MODEL=gpt-5-mini
```

**설정 방법:**
1. [OpenAI Platform](https://platform.openai.com/api-keys) 접속
2. API 키 생성
3. `CHATGPT_MODEL`은 기본값 `gpt-5-mini` 사용 (변경 가능)

### 5. 앱 URL (선택사항)

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 6. 시스템 사용자 설정 (필수)

```env
SYSTEM_GITHUB_USERNAME=ustudiopd
SYSTEM_GITHUB_ACCESS_TOKEN=your-github-personal-access-token
SYSTEM_USER_EMAIL=your-email@example.com (선택사항)
SYSTEM_USER_NAME=Your Name (선택사항)
```

**설정 방법:**
1. GitHub Personal Access Token 생성:
   - [GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
   - "Generate new token (classic)" 클릭
   - 필요한 권한 선택: `repo`, `read:user`, `user:email`
   - 토큰 생성 후 복사 (한 번만 표시됨!)
2. `.env.local`에 추가:
   - `SYSTEM_GITHUB_USERNAME`: GitHub 사용자명 (예: `ustudiopd`)
   - `SYSTEM_GITHUB_ACCESS_TOKEN`: 생성한 Personal Access Token
   - `SYSTEM_USER_EMAIL`: 이메일 (선택사항)
   - `SYSTEM_USER_NAME`: 표시할 이름 (선택사항)

## 전체 예시 (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xiygbsaewuqocaxoxeqn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# NextAuth
NEXTAUTH_SECRET=your-random-secret-key-here
NEXTAUTH_URL=http://localhost:3000

# OpenAI
OPENAI_API_KEY=sk-your-openai-api-key
CHATGPT_MODEL=gpt-5-mini

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 확인 방법

환경 변수를 설정한 후:

1. 개발 서버 재시작:
   ```bash
   npm run dev
   ```

2. 브라우저에서 `http://localhost:3000` 접속

3. 콘솔에서 경고 메시지 확인:
   - 환경 변수가 제대로 설정되면 경고가 사라집니다
   - 여전히 경고가 보이면 `.env.local` 파일을 확인하세요

## 문제 해결

### "Server error" 또는 "서버 설정 문제" 오류

1. `.env.local` 파일이 프로젝트 루트에 있는지 확인
2. 모든 필수 환경 변수가 설정되었는지 확인
3. 환경 변수 값에 따옴표나 공백이 없는지 확인
4. 개발 서버를 재시작 (`Ctrl+C` 후 `npm run dev`)

### GitHub OAuth 오류

- `GITHUB_CLIENT_ID`와 `GITHUB_CLIENT_SECRET`이 올바른지 확인
- Authorization callback URL이 정확한지 확인 (`/api/auth/callback/github`)

### Supabase 연결 오류

- `NEXT_PUBLIC_SUPABASE_URL`이 올바른지 확인
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`가 올바른지 확인
- Supabase 프로젝트가 활성 상태인지 확인

## 보안 주의사항

⚠️ **절대 다음을 Git에 커밋하지 마세요:**
- `.env.local` 파일
- 실제 API 키나 Secret 값
- 서비스 롤 키

`.gitignore`에 `.env.local`이 포함되어 있는지 확인하세요.

