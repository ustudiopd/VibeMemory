'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function DashboardPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [systemUser, setSystemUser] = useState<{ name?: string; email?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    // 로그인 없이 바로 프로젝트 로드
    fetchProjects();
    fetchSystemUser();
  }, []);

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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="mx-auto px-4 sm:px-6 lg:px-8" style={{ maxWidth: '1600px' }}>
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">VibeMemory</h1>
            </div>
            <div className="flex items-center space-x-4">
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

          <div className="mb-4">
            <Link
              href="/dashboard/import"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-slate-600 hover:bg-slate-700 transition-colors"
            >
              프로젝트 가져오기
            </Link>
          </div>

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
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow relative"
                >
                  <h3 className="text-lg font-semibold text-gray-900">
                    {project.repo_name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {project.repo_owner}
                  </p>
                  <div className="mt-4 flex items-center justify-between">
                    <Link
                      href={`/dashboard/projects/${project.id}`}
                      className="text-sm text-slate-600 hover:text-slate-800 transition-colors"
                    >
                      자세히 보기 →
                    </Link>
                    <button
                      onClick={() => handleDeleteClick(project.id)}
                      disabled={deletingId === project.id}
                      className="text-sm text-red-600 hover:text-red-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deletingId === project.id ? '삭제 중...' : '삭제'}
                    </button>
                  </div>
                </div>
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
