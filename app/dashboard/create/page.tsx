'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function CreateProjectPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    project_name: '',
    description: '',
    tech_spec: '',
    deployment_url: '',
    documentation_url: '',
    repository_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.project_name.trim()) {
      setError('프로젝트 이름은 필수입니다.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/projects/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_type: 'idea',
          ...formData,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.error || '프로젝트 생성에 실패했습니다.';
        const errorDetails = data.details ? ` (${data.details})` : '';
        throw new Error(`${errorMessage}${errorDetails}`);
      }

      // 프로젝트 상세 페이지로 이동
      router.push(`/dashboard/projects/${data.project_id}`);
    } catch (err) {
      console.error('Error creating project:', err);
      setError(err instanceof Error ? err.message : '프로젝트 생성에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-16 md:pb-0">
      <nav className="bg-white shadow">
        <div className="mx-auto px-4 sm:px-6 lg:px-8" style={{ maxWidth: '1600px' }}>
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/dashboard" className="text-xl font-bold text-gray-900 hover:text-gray-700">
                VibeMemory
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ maxWidth: '800px' }}>
        <div className="bg-white rounded-lg shadow p-6 md:p-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-6">프로젝트 만들기</h1>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="project_name" className="block text-sm font-medium text-gray-700 mb-2">
                프로젝트 이름 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="project_name"
                name="project_name"
                value={formData.project_name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="예: 나만의 할일 관리 앱"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                프로젝트 설명
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="프로젝트에 대한 간단한 설명을 입력하세요"
              />
            </div>

            <div>
              <label htmlFor="tech_spec" className="block text-sm font-medium text-gray-700 mb-2">
                기술 스펙
              </label>
              <textarea
                id="tech_spec"
                name="tech_spec"
                value={formData.tech_spec}
                onChange={handleChange}
                rows={5}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                placeholder="사용할 기술 스택, 프레임워크, 라이브러리 등을 입력하세요"
              />
            </div>

            <div>
              <label htmlFor="deployment_url" className="block text-sm font-medium text-gray-700 mb-2">
                실행 URL (선택)
              </label>
              <input
                type="url"
                id="deployment_url"
                name="deployment_url"
                value={formData.deployment_url}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://example.com"
              />
            </div>

            <div>
              <label htmlFor="repository_url" className="block text-sm font-medium text-gray-700 mb-2">
                저장소 URL (선택)
              </label>
              <input
                type="url"
                id="repository_url"
                name="repository_url"
                value={formData.repository_url}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://github.com/username/repo"
              />
            </div>

            <div>
              <label htmlFor="documentation_url" className="block text-sm font-medium text-gray-700 mb-2">
                문서 URL (선택)
              </label>
              <input
                type="url"
                id="documentation_url"
                name="documentation_url"
                value={formData.documentation_url}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://docs.example.com"
              />
            </div>

            <div className="flex justify-end space-x-4 pt-4">
              <Link
                href="/dashboard"
                className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                취소
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? '생성 중...' : '프로젝트 만들기'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

