'use client';

import { useState, useEffect } from 'react';

interface ProjectCardProps {
  project: {
    id: string;
    project_name?: string | null;
    repo_name?: string | null;
    project_type?: string | null;
    description?: string | null;
    updated_at?: string | null;
    primary_screenshot?: {
      id: string;
      storage_path: string;
      file_name: string;
    } | null;
    latest_comment?: {
      id: string;
      author_name: string;
      content: string;
      created_at: string;
    } | null;
  };
  onDelete: (id: string) => void;
  deletingId: string | null;
}

export default function ProjectCard({ project, onDelete, deletingId }: ProjectCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(true);
  const [thumbnailError, setThumbnailError] = useState(false);

  useEffect(() => {
    const fetchThumbnail = async () => {
      if (!project.primary_screenshot) {
        setThumbnailLoading(false);
        return;
      }

      try {
        setThumbnailLoading(true);
        setThumbnailError(false);
        const response = await fetch(`/api/projects/${project.id}/thumbnail`);
        const data = await response.json();

        if (response.ok && data.url) {
          setThumbnailUrl(data.url);
        } else {
          setThumbnailError(true);
        }
      } catch (err) {
        console.error('Error fetching thumbnail:', err);
        setThumbnailError(true);
      } finally {
        setThumbnailLoading(false);
      }
    };

    fetchThumbnail();
  }, [project.id, project.primary_screenshot]);

  return (
    <div
      className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow relative cursor-pointer overflow-hidden"
      onClick={(e) => {
        // 삭제 버튼 클릭 시에는 카드 클릭 이벤트 무시
        if ((e.target as HTMLElement).closest('button')) {
          return;
        }
        window.location.href = `/dashboard/projects/${project.id}`;
      }}
    >
      {/* 1. 제목 (프로젝트명과 삭제 버튼) */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 pr-2">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-gray-900">
              {project.project_name || project.repo_name}
            </h3>
            {project.project_type && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  project.project_type === 'idea'
                    ? 'bg-purple-100 text-purple-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {project.project_type === 'idea' ? '💡 아이디어' : '🔗 GitHub'}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(project.id);
          }}
          disabled={deletingId === project.id}
          className="text-sm text-red-600 hover:text-red-800 active:text-red-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 touch-manipulation flex-shrink-0"
        >
          {deletingId === project.id ? '삭제 중...' : '삭제'}
        </button>
      </div>

      {/* 2. 썸네일 이미지 */}
      {project.primary_screenshot && (
        <div className="aspect-[16/9] bg-gray-100 rounded-lg overflow-hidden mb-3 relative flex items-center justify-center">
          {thumbnailLoading ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-100">
              <div className="text-gray-400 text-sm">로딩 중...</div>
            </div>
          ) : thumbnailError || !thumbnailUrl ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-100">
              <div className="text-gray-400 text-sm">이미지 없음</div>
            </div>
          ) : (
            <img
              src={thumbnailUrl}
              alt={project.project_name || project.repo_name || '프로젝트 썸네일'}
              className="w-[70%] h-[70%] object-cover rounded-lg"
              loading="lazy"
            />
          )}
        </div>
      )}

      {/* 3. 날짜 */}
      {project.updated_at && (
        <p className="text-xs text-gray-500 mb-2">
          {new Date(project.updated_at).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      )}

      {/* 4. 설명 */}
      {project.description && (
        <div className="mt-2">
          <p className="text-sm text-gray-700 line-clamp-3">
            {project.description}
          </p>
        </div>
      )}

      {/* 5. 최신 댓글 */}
      {project.latest_comment && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 mb-1">
                {project.latest_comment.author_name || '익명'}
              </p>
              <p className="text-xs text-gray-600 line-clamp-2">
                {project.latest_comment.content}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {new Date(project.latest_comment.created_at).toLocaleDateString('ko-KR', {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

