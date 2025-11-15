'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Project {
  id: string;
  repo_name: string;
  repo_owner: string;
  repo_url: string;
  created_at: string;
}

interface GitHubRepo {
  name: string;
  owner: {
    login: string;
  };
  html_url: string;
  description: string;
}

interface ProjectListProps {
  projects: Project[];
  githubRepos: GitHubRepo[];
}

export default function ProjectList({ projects, githubRepos }: ProjectListProps) {
  const [importing, setImporting] = useState<string | null>(null);

  const handleImport = async (repo: GitHubRepo) => {
    setImporting(repo.name);
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

      if (!response.ok) {
        const error = await response.json();
        alert(`임포트 실패: ${error.error}`);
        return;
      }

      const result = await response.json();
      alert(`프로젝트가 성공적으로 임포트되었습니다!`);
      window.location.reload();
    } catch (error) {
      console.error('Import error:', error);
      alert('임포트 중 오류가 발생했습니다.');
    } finally {
      setImporting(null);
    }
  };

  const importedRepos = new Set(
    projects.map((p) => `${p.repo_owner}/${p.repo_name}`)
  );

  return (
    <div className="space-y-8">
      {/* Imported Projects */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">임포트된 프로젝트</h2>
        {projects.length === 0 ? (
          <p className="text-gray-500">아직 임포트된 프로젝트가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/dashboard/projects/${project.id}`}
                className="block p-6 border rounded-lg hover:shadow-lg transition-shadow"
              >
                <h3 className="font-semibold text-lg mb-2">
                  {project.repo_owner}/{project.repo_name}
                </h3>
                <p className="text-sm text-gray-600 mb-2">
                  {new Date(project.created_at).toLocaleDateString('ko-KR')}에 임포트됨
                </p>
                <span className="text-blue-600 text-sm">프로젝트 보기 →</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Available GitHub Repositories */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">GitHub 리포지토리</h2>
        {githubRepos.length === 0 ? (
          <p className="text-gray-500">GitHub 리포지토리를 불러올 수 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {githubRepos.map((repo) => {
              const repoKey = `${repo.owner.login}/${repo.name}`;
              const isImported = importedRepos.has(repoKey);

              return (
                <div
                  key={repo.html_url}
                  className="p-6 border rounded-lg hover:shadow-lg transition-shadow"
                >
                  <h3 className="font-semibold text-lg mb-2">
                    {repo.owner.login}/{repo.name}
                  </h3>
                  {repo.description && (
                    <p className="text-sm text-gray-600 mb-4">{repo.description}</p>
                  )}
                  {isImported ? (
                    <span className="text-green-600 text-sm">이미 임포트됨</span>
                  ) : (
                    <button
                      onClick={() => handleImport(repo)}
                      disabled={importing === repo.name}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {importing === repo.name ? '임포트 중...' : '임포트'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

