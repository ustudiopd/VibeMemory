'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import ProjectCard from '@/components/ProjectCard';

type SortOption = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';
type FilterOption = 'all' | 'github' | 'idea';

export default function DashboardPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [systemUser, setSystemUser] = useState<{ name?: string; email?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('updated_desc');
  const [filterOption, setFilterOption] = useState<FilterOption>('all');

  useEffect(() => {
    // 로그인 없이 바로 프로젝트 로드
    fetchProjects();
    fetchSystemUser();
  }, []);

  // 필터링 및 정렬된 프로젝트 목록
  const filteredAndSortedProjects = useMemo(() => {
    let filtered = projects;

    // 검색 필터
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((project) => {
        const name = (project.project_name || project.repo_name || '').toLowerCase();
        const description = (project.description || '').toLowerCase();
        return name.includes(query) || description.includes(query);
      });
    }

    // 타입 필터
    if (filterOption !== 'all') {
      filtered = filtered.filter((project) => {
        const projectType = project.project_type || 'github';
        return projectType === filterOption;
      });
    }

    // 정렬
    const sorted = [...filtered].sort((a, b) => {
      switch (sortOption) {
        case 'updated_desc':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        case 'updated_asc':
          return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
        case 'created_desc':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'created_asc':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'name_asc':
          return (a.project_name || a.repo_name || '').localeCompare(b.project_name || b.repo_name || '', 'ko');
        case 'name_desc':
          return (b.project_name || b.repo_name || '').localeCompare(a.project_name || a.repo_name || '', 'ko');
        default:
          return 0;
      }
    });

    return sorted;
  }, [projects, searchQuery, sortOption, filterOption]);

  const fetchSystemUser = async () => {
    try {
      const response = await fetch('/api/system/user');
      if (response.ok) {
        const data = await response.json();
        setSystemUser(data.user || null);
      }
    } catch (error) {
      console.error('Error fetching system user:', error);
    }
  };

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/projects');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '프로젝트를 불러오는데 실패했습니다.');
      }

      setProjects(data.projects || []);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching projects:', error);
      setLoading(false);
    }
  };

  const handleDeleteClick = (projectId: string) => {
    setConfirmDeleteId(projectId);
  };

  const handleDeleteConfirm = async (projectId: string) => {
    try {
      setDeletingId(projectId);
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '프로젝트 삭제에 실패했습니다.');
      }

      // 목록에서 제거
      setProjects(projects.filter((p) => p.id !== projectId));
      setConfirmDeleteId(null);
    } catch (error) {
      console.error('Error deleting project:', error);
      alert(error instanceof Error ? error.message : '프로젝트 삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteCancel = () => {
    setConfirmDeleteId(null);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600 mx-auto"></div>
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
              <h1 className="text-xl font-bold text-gray-900">VibeMemory</h1>
            </div>
            <div className="flex items-center">
              <div className="flex flex-col items-end">
                <span className="text-sm font-medium text-gray-900">
                  {systemUser?.name || '시스템 사용자'}
                </span>
                {systemUser?.email && (
                  <span className="text-xs text-gray-500">
                    {systemUser.email}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto py-6 sm:px-6 lg:px-8" style={{ maxWidth: '1600px' }}>
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900">프로젝트</h2>
            <p className="mt-1 text-sm text-gray-600">
              GitHub 리포지토리를 가져와 지식 자산으로 변환하세요
            </p>
          </div>

        <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <Link
              href="/dashboard/import"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-slate-600 hover:bg-slate-700 active:bg-slate-800 transition-colors min-h-[44px] touch-manipulation"
            >
              프로젝트 가져오기
            </Link>
            <Link
              href="/dashboard/create"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-slate-600 hover:bg-slate-700 active:bg-slate-800 transition-colors min-h-[44px] touch-manipulation"
            >
              프로젝트 만들기
            </Link>
          </div>

          {/* 검색, 필터, 정렬 */}
          <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-3">
            {/* 검색 */}
            <div className="relative flex-1 sm:w-64">
              <input
                type="text"
                placeholder="프로젝트 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
              />
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>

            {/* 필터 */}
            <select
              value={filterOption}
              onChange={(e) => setFilterOption(e.target.value as FilterOption)}
              className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
            >
              <option value="all">전체</option>
              <option value="github">GitHub</option>
              <option value="idea">아이디어</option>
            </select>

            {/* 정렬 */}
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
            >
              <option value="updated_desc">최근 업데이트순</option>
              <option value="updated_asc">오래된 업데이트순</option>
              <option value="created_desc">최근 생성순</option>
              <option value="created_asc">오래된 생성순</option>
              <option value="name_asc">이름순 (가나다)</option>
              <option value="name_desc">이름순 (역순)</option>
            </select>
          </div>
        </div>

        {/* 검색 결과 카운트 */}
        {searchQuery || filterOption !== 'all' ? (
          <div className="mb-4 text-sm text-gray-600">
            총 {filteredAndSortedProjects.length}개의 프로젝트
            {searchQuery && ` (검색: "${searchQuery}")`}
            {filterOption !== 'all' && ` (필터: ${filterOption === 'github' ? 'GitHub' : '아이디어'})`}
          </div>
        ) : null}

          {projects.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">아직 가져온 프로젝트가 없습니다.</p>
              <Link
                href="/dashboard/import"
                className="mt-4 inline-block text-slate-600 hover:text-slate-800 transition-colors"
              >
                첫 프로젝트 가져오기 →
              </Link>
            </div>
          ) : filteredAndSortedProjects.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">
                {searchQuery || filterOption !== 'all'
                  ? '검색 결과가 없습니다.'
                  : '프로젝트가 없습니다. 프로젝트를 가져오거나 만들어보세요.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredAndSortedProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDelete={handleDeleteClick}
                  deletingId={deletingId}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 삭제 확인 다이얼로그 */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              프로젝트 삭제 확인
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              이 프로젝트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없으며, 프로젝트의 모든 데이터(파일, 임베딩, 분석 결과 등)가 영구적으로 삭제됩니다.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={handleDeleteCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => handleDeleteConfirm(confirmDeleteId)}
                disabled={deletingId === confirmDeleteId}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingId === confirmDeleteId ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
