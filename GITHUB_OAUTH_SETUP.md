# GitHub OAuth 설정 가이드

GitHub OAuth App을 생성하여 Client ID와 Secret을 받는 방법입니다.

## 1단계: GitHub Developer Settings 접속

1. GitHub에 로그인
2. 우측 상단 프로필 아이콘 클릭
3. **Settings** 클릭
4. 좌측 메뉴에서 **Developer settings** 클릭
   - 또는 직접 접속: https://github.com/settings/developers

## 2단계: OAuth Apps 메뉴로 이동

1. 좌측 메뉴에서 **OAuth Apps** 클릭
2. **New OAuth App** 버튼 클릭

## 3단계: OAuth App 정보 입력

다음 정보를 입력하세요:

### Application name
```
VibeMemory
```
(또는 원하는 이름)

### Homepage URL
**개발 환경:**
```
http://localhost:3000
```

**프로덕션 환경:**
```
https://your-domain.com
```

### Authorization callback URL
**개발 환경:**
```
http://localhost:3000/api/auth/callback/github
```

**프로덕션 환경:**
```
https://your-domain.com/api/auth/callback/github
```

### Application description (선택사항)
```
개발자의 GitHub 리포지토리를 지능형 지식 자관으로 변환하는 시스템
```

## 4단계: OAuth App 생성

1. **Register application** 버튼 클릭
2. 생성 완료!

## 5단계: Client ID와 Secret 복사

생성된 OAuth App 페이지에서:

1. **Client ID** 복사
   - 바로 보이는 값입니다
   - 예: `Iv1.8a61f9b3a7aba766`

2. **Client secrets** 섹션에서 **Generate a new client secret** 클릭
   - 비밀번호 확인 요청 시 입력
   - 생성된 **Client secret** 복사
   - ⚠️ **주의**: 이 페이지를 벗어나면 다시 볼 수 없습니다! 바로 복사하세요.
   - 예: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

## 6단계: .env.local에 추가

복사한 값을 `.env.local` 파일에 추가:

```env
GITHUB_CLIENT_ID=복사한-Client-ID
GITHUB_CLIENT_SECRET=복사한-Client-Secret
```

예시:
```env
GITHUB_CLIENT_ID=Iv1.8a61f9b3a7aba766
GITHUB_CLIENT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

## 7단계: 개발 서버 재시작

환경 변수를 추가한 후 개발 서버를 재시작하세요:

```bash
npm run dev
```

## 중요 사항

### 개발 환경과 프로덕션 환경

- **개발용 OAuth App**: `localhost:3000` 사용
- **프로덕션용 OAuth App**: 실제 도메인 사용
- 또는 하나의 OAuth App에 여러 Callback URL 추가 가능 (GitHub Enterprise Cloud)

### Client Secret 보안

- ⚠️ **절대 공개하지 마세요**
- Git에 커밋하지 마세요 (`.env.local`은 `.gitignore`에 포함됨)
- 코드에 하드코딩하지 마세요
- 유출 시 즉시 재생성하세요

### 권한 (Scopes)

현재 설정된 권한:
- `read:user` - 사용자 정보 읽기
- `user:email` - 이메일 주소 읽기
- `repo` - 리포지토리 접근 (프로젝트 임포트용)

필요에 따라 권한을 조정할 수 있습니다.

## 문제 해결

### "redirect_uri_mismatch" 오류

- Authorization callback URL이 정확히 일치하는지 확인
- `http://localhost:3000/api/auth/callback/github` (슬래시 포함)
- 프로토콜(`http` vs `https`) 확인

### "bad_verification_code" 오류

- Client Secret이 올바른지 확인
- 환경 변수가 제대로 로드되었는지 확인 (서버 재시작)

### OAuth App을 찾을 수 없음

- GitHub에 로그인되어 있는지 확인
- 올바른 GitHub 계정인지 확인
- OAuth Apps 목록에서 확인

## 참고 링크

- [GitHub Developer Settings](https://github.com/settings/developers)
- [GitHub OAuth Apps 문서](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)

