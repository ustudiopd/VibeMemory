import Link from 'next/link';
import MobileTabBar from '@/components/MobileTabBar';

export default function Home() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-200">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <span className="font-bold text-xl text-slate-900">VibeMemory</span>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-24 sm:py-32 text-center">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
              GitHub 리포지토리,<br />AI 지식 자산으로
            </h1>
            <p className="mt-8 text-lg max-w-2xl mx-auto text-slate-600">
              AI 기반 RAG 검색과 자동 분석으로 프로젝트를 더 스마트하게 관리하세요.
            </p>

            <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-x-4 gap-y-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2 bg-slate-900 text-slate-50 shadow hover:bg-slate-900/90 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 transition-colors"
              >
                대시보드로 이동
              </Link>
              <Link
                href="/dashboard/import"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2 border border-slate-300 bg-white shadow-sm hover:bg-slate-50 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 transition-colors"
              >
                + 프로젝트 가져오기
              </Link>
              <Link
                href="/dashboard/create"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2 border border-slate-300 bg-white shadow-sm hover:bg-slate-50 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 transition-colors"
              >
                + 프로젝트 만들기
              </Link>
            </div>

            {/* Flow Diagram */}
            <div className="mt-20 sm:mt-28">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-8">
                <div className="w-full sm:w-1/3 p-6 bg-slate-50 rounded-lg border border-slate-200">
                  <svg className="w-12 h-12 mx-auto text-slate-400" fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                  </svg>
                  <p className="mt-4 font-semibold text-slate-700">GitHub 리포지토리</p>
                  <p className="text-sm text-slate-500">.md 파일, 코드 조각</p>
                </div>
                
                <svg className="w-12 h-12 text-slate-400 hidden sm:block" fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25 21 12m0 0-3.75 3.75M21 12H3" />
                </svg>
                <svg className="w-12 h-12 text-slate-400 sm:hidden" fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
                </svg>

                <div className="w-full sm:w-1/3 p-6 bg-slate-900 rounded-lg shadow-lg">
                  <svg className="w-12 h-12 mx-auto text-slate-50" fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h3.75" />
                  </svg>
                  <p className="mt-4 font-semibold text-white">지능형 지식 자산</p>
                  <p className="text-sm text-slate-300">RAG 챗봇, AI 분석</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 sm:py-32 bg-slate-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold tracking-tight text-center text-slate-900">
              AI가 당신의 모든 지식을 연결합니다
            </h2>

            <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-10">
              <div className="p-6 bg-white rounded-lg border border-slate-200 shadow-sm">
                <div className="flex items-center justify-center w-12 h-12 bg-slate-900 text-white rounded-lg mb-4">
                  <svg className="w-6 h-6" fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">자동 지식 자산화</h3>
                <p className="text-base text-slate-600">
                  GitHub 리포지토리의 `.md` 파일을 자동으로 분석하여 실시간 동기화되는 RAG 지식베이스를 구축합니다.
                </p>
              </div>
              
              <div className="p-6 bg-white rounded-lg border border-slate-200 shadow-sm">
                <div className="flex items-center justify-center w-12 h-12 bg-slate-900 text-white rounded-lg mb-4">
                  <svg className="w-6 h-6" fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">지능형 RAG 챗봇</h3>
                <p className="text-base text-slate-600">
                  "이 기능 어떤 프로젝트에 썼지?" 과거의 코드와 문서를 기반으로 AI 챗봇에게 질문하고 즉시 정확한 답변을 얻으세요.
                </p>
              </div>
              
              <div className="p-6 bg-white rounded-lg border border-slate-200 shadow-sm">
                <div className="flex items-center justify-center w-12 h-12 bg-slate-900 text-white rounded-lg mb-4">
                  <svg className="w-6 h-6" fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-1.125m-1.5 1.125a6.01 6.01 0 0 1-1.5-1.125m1.5 1.125v-1.5A2.25 2.25 0 0 0 9.75 9.75h-1.5A2.25 2.25 0 0 0 6 12v1.5m6 4.5v-1.875m0 0a6.01 6.01 0 0 0 1.5-1.125m-1.5 1.125a6.01 6.01 0 0 1-1.5-1.125m1.5 1.125v-1.5a2.25 2.25 0 0 0-2.25-2.25h-1.5A2.25 2.25 0 0 0 6 12v1.5m0 0h1.5m1.5 0h1.5m0 0v1.875m0 0a6.01 6.01 0 0 0 1.5-1.125m-1.5 1.125a6.01 6.01 0 0 1-1.5-1.125M12 18.75m-3-1.875a6.01 6.01 0 0 1-1.5-1.125m1.5 1.125v-1.5a2.25 2.25 0 0 0-2.25-2.25h-1.5A2.25 2.25 0 0 0 3 13.5v1.5m0 0h1.5m1.5 0h1.5m0 0v1.875m0 0a6.01 6.01 0 0 0 1.5-1.125M9 18.75m-3-1.875a6.01 6.01 0 0 1-1.5-1.125m1.5 1.125v-1.5a2.25 2.25 0 0 0-2.25-2.25H3a2.25 2.25 0 0 0-2.25 2.25v1.5m0 0h1.5m1.5 0h1.5M12 18.75m3-1.875a6.01 6.01 0 0 0 1.5-1.125m-1.5 1.125v-1.5a2.25 2.25 0 0 1 2.25-2.25h1.5a2.25 2.25 0 0 1 2.25 2.25v1.5m0 0h-1.5m-1.5 0h-1.5m0 0v1.875m0 0a6.01 6.01 0 0 0 1.5-1.125m3 1.875m3-1.875a6.01 6.01 0 0 0 1.5-1.125m-1.5 1.125v-1.5a2.25 2.25 0 0 1 2.25-2.25h1.5a2.25 2.25 0 0 1 2.25 2.25v1.5m0 0h-1.5m-1.5 0h-1.5m0 0v1.875M15 18.75m3-1.875a6.01 6.01 0 0 0 1.5-1.125m-1.5 1.125v-1.5a2.25 2.25 0 0 1 2.25-2.25h1.5a2.25 2.25 0 0 1 2.25 2.25v1.5m0 0h-1.5m-1.5 0h-1.5" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">아이디어 인큐베이터</h3>
                <p className="text-base text-slate-600">
                  새 아이디어를 등록하고, AI 챗봇과 함께 디벨롭하여 구체적인 '프로젝트 명세서'를 완성하고 개발로 연계하세요.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Getting Started Section */}
        <section className="py-24 sm:py-32">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold tracking-tight text-center text-slate-900">
              VibeMemory 시작하기
            </h2>

            <div className="mt-20 grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="p-8 border border-slate-200 rounded-lg bg-white shadow-sm">
                <h3 className="text-xl font-semibold text-slate-900">1. 기존 프로젝트 활용 (Import)</h3>
                <p className="mt-2 text-base text-slate-600">
                  잊혀진 GitHub 리포지토리의 지식을 되살리세요.
                </p>
                <p className="mt-4 text-sm font-medium text-slate-500">
                  GitHub 연결 → AI 자동 스캔 → RAG 챗봇 활성화
                </p>
                <Link
                  href="/dashboard/import"
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2 mt-6 border border-slate-200 bg-white shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 transition-colors"
                >
                  → 프로젝트 가져오기로 시작하기
                </Link>
              </div>

              <div className="p-8 border border-slate-200 rounded-lg bg-white shadow-sm">
                <h3 className="text-xl font-semibold text-slate-900">2. 새 아이디어 구상 (Create)</h3>
                <p className="mt-2 text-base text-slate-600">
                  머릿속 아이디어를 AI와 함께 구체적인 명세서로 만드세요.
                </p>
                <p className="mt-4 text-sm font-medium text-slate-500">
                  아이디어 등록 → '아이디어 노트'에서 디벨롭 → '명세서' 완성
                </p>
                <Link
                  href="/dashboard/create"
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2 mt-6 border border-slate-200 bg-white shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 transition-colors"
                >
                  → 새 프로젝트 만들기로 시작하기
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <p className="text-center text-sm text-slate-500">
            &copy; 2025 VibeMemory. All rights reserved.
          </p>
        </div>
      </footer>

      <MobileTabBar />
    </div>
  );
}

