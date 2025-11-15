# VibeMemory

개발자의 GitHub 리포지토리를 지능형 지식 자산으로 변환하는 시스템

## 환경 변수 설정

`.env.local` 파일을 생성하고 다음 환경 변수들을 설정하세요:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# NextAuth
NEXTAUTH_SECRET=your-nextauth-secret
NEXTAUTH_URL=http://localhost:3000

# OpenAI
OPENAI_API_KEY=your-openai-api-key
CHATGPT_MODEL=gpt-4.1-mini

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

## 주요 기능

- GitHub 리포지토리 임포트 및 자동 Webhook 등록
- RAG 기반 지식 검색 (하이브리드 검색: FTS + Vector)
- AI 자동 리뷰 (아이디어, 기술, 특허 분석)
- 실시간 동기화 (GitHub Push 이벤트)
- 프로젝트별/전체 챗봇 (SSE 스트리밍)

## API 엔드포인트

- `POST /api/projects/import` - 프로젝트 임포트
- `POST /api/github/webhook` - GitHub Webhook
- `POST /api/chat` - 전체 프로젝트 챗봇
- `POST /api/projects/[id]/chat` - 프로젝트별 챗봇

