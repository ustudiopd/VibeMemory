'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  description: string;
  updated_at: string;
  private?: boolean;
  default_branch?: string;
}

interface ImportedProject {
  id: string;
  repo_owner: string;
  repo_name: string;
  repo_url: string;
}

export default function ImportPage() {
  const router = useRouter();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [filteredRepositories, setFilteredRepositories] = useState<Repository[]>([]);
  const [importedProjects, setImportedProjects] = useState<Map<string, ImportedProject>>(new Map());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    // 로그인 없이 바로 리포지토리 및 임포트된 프로젝트 로드
    fetchRepositories();
    fetchImportedProjects();
  }, []);

  const fetchRepositories = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/github/repositories');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '리포지토리를 불러오는데 실패했습니다.');
      }

      const repos = data.repositories || [];
      setRepositories(repos);
      setFilteredRepositories(repos);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching repositories:', error);
      setError(error instanceof Error ? error.message : '리포지토리를 불러오는데 실패했습니다.');
      setLoading(false);
    }
  };

  const fetchImportedProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        const projects = data.projects || [];
        
        // repo_url을 키로 하는 Map 생성
        const projectMap = new Map<string, ImportedProject>();
        projects.forEach((project: ImportedProject) => {
          projectMap.set(project.repo_url, project);
        });
        
        setImportedProjects(projectMap);
      }
    } catch (error) {
      console.error('Error fetching imported projects:', error);
      // 에러가 발생해도 계속 진행 (임포트된 프로젝트 표시는 선택적 기능)
    }
  };

  const isImported = (repo: Repository): ImportedProject | null => {
    const repoUrl = `https://github.com/${repo.owner.login}/${repo.name}`;
    return importedProjects.get(repoUrl) || null;
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setFilteredRepositories(repositories);
      return;
    }
    
    const filtered = repositories.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query.toLowerCase()) ||
        repo.owner.login.toLowerCase().includes(query.toLowerCase()) ||
        (repo.description && repo.description.toLowerCase().includes(query.toLowerCase()))
    );
    setFilteredRepositories(filtered);
  };

  const handleImport = async (repo: Repository) => {
    setImporting(repo.full_name);
    setError(null);

    try {
      const response = await fetch('/api/projects/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repo_name: repo.name,
          repo_owner: repo.owner.login,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // 이미 임포트된 프로젝트인 경우 프로젝트 페이지로 이동
        if (response.status === 409 && data.project_id) {
          router.push(`/dashboard/projects/${data.project_id}`);
          return;
        }
        
        // 진행 중인 임포트가 있는 경우
        if (response.status === 409) {
          throw new Error('이 리포지토리는 현재 임포트 중입니다. 잠시 후 다시 시도해주세요.');
        }
        
        throw new Error(data.error || '임포트에 실패했습니다.');
      }

      router.push(`/dashboard/projects/${data.project_id}`);
    } catch (error) {
      console.error('Error importing project:', error);
      setError(error instanceof Error ? error.message : '임포트에 실패했습니다.');
      setImporting(null);
    }
  };

  const handleResetLocks = async (repo?: Repository) => {
    try {
      const response = await fetch('/api/projects/import/reset-locks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          repo
            ? {
                repo_owner: repo.owner.login,
                repo_name: repo.name,
              }
            : {}
        ),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '잠금 초기화에 실패했습니다.');
      }

      alert(data.message || '잠금이 초기화되었습니다.');
      setError(null);
    } catch (error) {
      console.error('Error resetting locks:', error);
      alert(error instanceof Error ? error.message : '잠금 초기화에 실패했습니다.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-16 md:pb-0">
      <nav className="bg-white shadow">
        <div className="mx-auto px-4 sm:px-6 lg:px-8" style={{ maxWidth: '1600px' }}>
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/dashboard" className="text-xl font-bold text-gray-900">
                VibeMemory
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/dashboard"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                ← 대시보드로 돌아가기
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto py-6 sm:px-6 lg:px-8" style={{ maxWidth: '1600px' }}>
        <div className="px-4 py-6 sm:px-0">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            프로젝트 가져오기
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            GitHub 리포지토리를 선택하여 VibeMemory에 가져오세요
          </p>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex justify-between items-start">
                <p className="text-sm text-red-800 flex-1">{error}</p>
                {error.includes('임포트 중') && (
                  <button
                    onClick={() => handleResetLocks()}
                    className="ml-4 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                  >
                    잠금 초기화
                  </button>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
              <p className="text-gray-500 mt-4">
                GitHub 리포지토리를 불러오는 중...
              </p>
            </div>
          ) : repositories.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">
                리포지토리를 찾을 수 없습니다.
              </p>
              <button
                onClick={fetchRepositories}
                className="mt-4 px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                다시 시도
              </button>
            </div>
          ) : (
            <>
              {/* Search Bar */}
              <div className="mb-6">
                <input
                  type="text"
                  placeholder="리포지토리 검색..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
                {searchQuery && (
                  <p className="mt-2 text-sm text-gray-500">
                    {filteredRepositories.length}개의 리포지토리 찾음
                  </p>
                )}
              </div>

              {/* Repository List */}
              <div className="grid grid-cols-1 gap-4">
                {filteredRepositories.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">
                      검색 결과가 없습니다.
                    </p>
                  </div>
                ) : (
                  filteredRepositories.map((repo) => (
                <div
                  key={repo.id}
                  className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">
                        {repo.name}
                      </h3>
                      {repo.private && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                          Private
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-2">
                      {repo.owner.login} / {repo.name}
                    </p>
                    {repo.description && (
                      <p className="text-sm text-gray-500 mb-2 line-clamp-2">
                        {repo.description}
                      </p>
                    )}
                    <p className="text-xs text-gray-400">
                      최근 업데이트: {new Date(repo.updated_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  {(() => {
                    const importedProject = isImported(repo);
                    const isAlreadyImported = !!importedProject;
                    
                    return (
                      <button
                        onClick={() => {
                          if (isAlreadyImported && importedProject) {
                            // 이미 임포트된 프로젝트는 상세 페이지로 이동
                            router.push(`/dashboard/projects/${importedProject.id}`);
                          } else {
                            // 새로 임포트
                            handleImport(repo);
                          }
                        }}
                        disabled={importing === repo.full_name}
                        className={`
                          px-6 py-2 rounded-lg transition-colors whitespace-nowrap min-h-[44px] touch-manipulation
                          ${isAlreadyImported
                            ? 'bg-gray-300 text-gray-600 cursor-pointer hover:bg-gray-400'
                            : 'bg-slate-600 text-white hover:bg-slate-700 active:bg-slate-800'
                          }
                          disabled:opacity-50 disabled:cursor-not-allowed
                        `}
                        title={isAlreadyImported ? '이미 임포트된 프로젝트입니다. 클릭하여 상세 페이지로 이동합니다.' : '프로젝트 가져오기'}
                      >
                        {importing === repo.full_name ? (
                          <span className="flex items-center">
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            가져오는 중...
                          </span>
                        ) : isAlreadyImported ? (
                          '이미 가져옴'
                        ) : (
                          '가져오기'
                        )}
                      </button>
                    );
                  })()}
                </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

