import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 lg:px-8" style={{ maxWidth: '1600px' }}>
          <div className="flex items-center h-16">
            <h1 className="text-2xl font-bold text-gray-900">VibeMemory</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex justify-center p-8 pt-8">
        <div className="max-w-4xl w-full text-center">
          <h2 className="text-5xl font-bold text-gray-900 mb-6">
            개발자의 GitHub 리포지토리를
            <br />
            지능형 지식 자산으로 변환
          </h2>
          <p className="text-xl text-gray-600 mb-12">
            AI 기반 RAG 검색과 자동 분석으로 프로젝트를 더 스마트하게 관리하세요
          </p>
          
          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center px-8 py-4 text-base font-semibold rounded-lg text-white bg-slate-600 hover:bg-slate-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 min-w-[200px]"
            >
              <svg
                className="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              대시보드로 이동
            </Link>
            <Link
              href="/dashboard/import"
              className="inline-flex items-center justify-center px-8 py-4 text-base font-semibold rounded-lg text-slate-700 bg-white border-2 border-slate-300 hover:border-slate-400 hover:bg-slate-50 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 min-w-[200px]"
            >
              <svg
                className="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              프로젝트 가져오기
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

