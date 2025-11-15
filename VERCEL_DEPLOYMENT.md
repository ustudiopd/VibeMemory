# Vercel 배포 가이드

Vercel에 배포할 때 필요한 환경 변수 설정 가이드입니다.

## 1. Vercel 프로젝트 생성 및 첫 배포

1. [Vercel Dashboard](https://vercel.com/dashboard)에 로그인
2. "Add New..." → "Project" 클릭
3. GitHub 리포지토리 `ustudiopd/VibeMemory` 선택
4. 프로젝트 설정 후 **"Deploy" 클릭** (환경 변수 없이 먼저 배포)

### ⚠️ 중요: 배포 URL 확인

배포가 완료되면:
1. Vercel 대시보드에서 배포 URL 확인
   - 예: `https://vibememory-xxx.vercel.app` 또는 `https://vibememory.vercel.app`
2. 이 URL을 메모해두세요 (다음 단계에서 사용)

## 2. 환경 변수 설정 (배포 URL 확인 후)

배포 URL을 확인한 후, Vercel 프로젝트 설정에서 **Settings → Environment Variables**로 이동하여 다음 환경 변수들을 추가하세요.

### 필수 환경 변수

#### Supabase 설정
```env
NEXT_PUBLIC_SUPABASE_URL=https://xiygbsaewuqocaxoxeqn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

#### GitHub OAuth 설정
```env
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

**중요**: GitHub OAuth App의 Callback URL을 Vercel 배포 URL로 변경해야 합니다:
- **Authorization callback URL**: `https://your-project.vercel.app/api/auth/callback/github`

#### NextAuth 설정
```env
NEXTAUTH_SECRET=your-random-secret-key
NEXTAUTH_URL=https://your-actual-vercel-url.vercel.app
```

**생성 방법**: 
```bash
openssl rand -base64 32
```

**⚠️ 중요**: `NEXTAUTH_URL`은 **1단계에서 확인한 실제 배포 URL**을 입력하세요.

#### OpenAI 설정
```env
OPENAI_API_KEY=sk-your-openai-api-key
CHATGPT_MODEL=gpt-4.1-mini
```

#### 앱 URL (웹훅 URL 자동 생성용) ⚠️ 필수
```env
NEXT_PUBLIC_APP_URL=https://your-actual-vercel-url.vercel.app
```

**⚠️ 중요**: 
- 이 값은 **1단계에서 확인한 실제 배포 URL**을 입력하세요.
- 이 값이 없으면 웹훅 URL이 잘못 생성됩니다.
- 웹훅 URL: `{NEXT_PUBLIC_APP_URL}/api/github/webhook`
- 예시: `https://vibememory-xxx.vercel.app/api/github/webhook`

#### 시스템 사용자 설정
```env
SYSTEM_GITHUB_USERNAME=ustudiopd
SYSTEM_GITHUB_ACCESS_TOKEN=your-github-personal-access-token
SYSTEM_USER_EMAIL=your-email@example.com
SYSTEM_USER_NAME=Your Name
```

## 3. GitHub 웹훅 설정

### 웹훅 URL 확인

배포 후 Vercel에서 제공하는 URL을 확인하세요:
- 예: `https://vibememory.vercel.app`
- 웹훅 엔드포인트: `https://vibememory.vercel.app/api/github/webhook`

### 웹훅 Secret 생성

웹훅 Secret은 랜덤 문자열로 생성합니다:

```bash
# 방법 1: OpenSSL 사용
openssl rand -hex 32

# 방법 2: Node.js 사용
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

생성된 Secret을 `GITHUB_WEBHOOK_SECRET` 환경 변수에 설정하세요.

### GitHub 리포지토리에 웹훅 등록

#### 방법 1: 자동 등록 (권장)

프로젝트 임포트 시 자동으로 웹훅이 등록됩니다:
1. VibeMemory 앱에 로그인
2. 프로젝트 임포트
3. 웹훅이 자동으로 생성됨

#### 방법 2: 수동 등록

1. GitHub 리포지토리 → **Settings** → **Webhooks** → **Add webhook**
2. 다음 정보 입력:
   - **Payload URL**: `https://your-project.vercel.app/api/github/webhook`
   - **Content type**: `application/json`
   - **Secret**: `GITHUB_WEBHOOK_SECRET`에 설정한 값
   - **Which events**: `Just the push event` 선택
3. **Add webhook** 클릭

## 4. 환경 변수 설정 체크리스트

Vercel 대시보드에서 다음 환경 변수들이 모두 설정되었는지 확인하세요:

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `GITHUB_CLIENT_ID`
- [ ] `GITHUB_CLIENT_SECRET`
- [ ] `GITHUB_WEBHOOK_SECRET`
- [ ] `NEXTAUTH_SECRET`
- [ ] `NEXTAUTH_URL` (Vercel 배포 URL)
- [ ] `OPENAI_API_KEY`
- [ ] `CHATGPT_MODEL`
- [ ] `NEXT_PUBLIC_APP_URL` (Vercel 배포 URL)
- [ ] `SYSTEM_GITHUB_USERNAME`
- [ ] `SYSTEM_GITHUB_ACCESS_TOKEN`
- [ ] `SYSTEM_USER_EMAIL` (선택사항)
- [ ] `SYSTEM_USER_NAME` (선택사항)

## 3. 환경 변수 추가 후 재배포

환경 변수를 모두 추가한 후:
1. Vercel 대시보드 → **Deployments** 탭
2. 최신 배포의 **"..." 메뉴** → **"Redeploy"** 클릭
3. 또는 GitHub에 새로운 커밋을 푸시하면 자동 재배포됨

## 4. 배포 후 확인 사항

### 1. GitHub OAuth Callback URL 업데이트
1. [GitHub Developer Settings](https://github.com/settings/developers) 접속
2. OAuth App 선택
3. **Authorization callback URL**을 실제 Vercel URL로 변경:
   - `https://your-actual-vercel-url.vercel.app/api/auth/callback/github`

### 2. 웹훅 테스트
1. VibeMemory 앱에서 프로젝트 임포트
2. GitHub 리포지토리에 Push 이벤트 발생
3. Vercel 로그에서 웹훅 수신 확인
   - Vercel 대시보드 → Deployments → 해당 배포 → Functions 탭

## 5. 배포 순서 요약

처음 배포할 때는 다음 순서를 따르세요:

1. ✅ **첫 배포** (환경 변수 없이)
   - Vercel에서 프로젝트 생성 및 배포
   - 배포 URL 확인 (예: `https://vibememory-xxx.vercel.app`)

2. ✅ **환경 변수 추가**
   - 배포 URL을 확인한 후 환경 변수 설정
   - 특히 `NEXT_PUBLIC_APP_URL`과 `NEXTAUTH_URL`에 실제 배포 URL 입력

3. ✅ **재배포**
   - 환경 변수 추가 후 Redeploy 또는 새 커밋 푸시

4. ✅ **GitHub OAuth Callback URL 업데이트**
   - GitHub OAuth App 설정에서 Callback URL을 실제 배포 URL로 변경

## 6. 문제 해결

### 웹훅이 작동하지 않는 경우

1. **웹훅 URL 확인**
   - GitHub 리포지토리 → Settings → Webhooks에서 URL 확인
   - `https://your-project.vercel.app/api/github/webhook` 형식인지 확인

2. **Secret 확인**
   - GitHub 웹훅 설정의 Secret과 `GITHUB_WEBHOOK_SECRET` 환경 변수가 일치하는지 확인

3. **Vercel 로그 확인**
   - Vercel 대시보드 → Deployments → 해당 배포 → Functions 탭
   - `/api/github/webhook` 함수의 로그 확인

### OAuth 인증 오류

1. **Callback URL 확인**
   - GitHub OAuth App의 Callback URL이 Vercel URL과 일치하는지 확인
   - `https://your-project.vercel.app/api/auth/callback/github`

2. **환경 변수 확인**
   - `NEXTAUTH_URL`이 Vercel 배포 URL과 일치하는지 확인
   - `GITHUB_CLIENT_ID`와 `GITHUB_CLIENT_SECRET`이 올바른지 확인

### 환경 변수가 적용되지 않는 경우

1. **재배포 필요**
   - 환경 변수 추가/수정 후 자동으로 재배포됨
   - 수동 재배포: Deployments → "Redeploy"

2. **환경 확인**
   - Production, Preview, Development 환경별로 설정 가능
   - 모든 환경에 적용하려면 각각 설정

## 7. 참고 링크

- [Vercel 환경 변수 문서](https://vercel.com/docs/concepts/projects/environment-variables)
- [GitHub OAuth Apps](https://github.com/settings/developers)
- [NextAuth.js 배포 가이드](https://next-auth.js.org/deployment)

