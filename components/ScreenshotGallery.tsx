'use client';

import { useState, useEffect, useCallback } from 'react';
import ScreenshotItem from './ScreenshotItem';

interface Screenshot {
  id: string;
  project_id: string;
  storage_path: string;
  file_name: string;
  caption: string | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  position: number;
  created_at: string;
}

interface ScreenshotGalleryProps {
  projectId: string;
}

export default function ScreenshotGallery({ projectId }: ScreenshotGalleryProps) {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScreenshots = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/screenshots?limit=100`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '스크린샷을 불러올 수 없습니다.');
      }

      setScreenshots(data.screenshots || []);
    } catch (err) {
      console.error('Error fetching screenshots:', err);
      setError(err instanceof Error ? err.message : '스크린샷을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      fetchScreenshots();
    }
  }, [projectId, fetchScreenshots]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`/api/projects/${projectId}/screenshots`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || '업로드에 실패했습니다.');
        }

        return data.screenshot;
      });

      await Promise.all(uploadPromises);
      await fetchScreenshots(); // 목록 새로고침
    } catch (err) {
      console.error('Error uploading screenshots:', err);
      setError(err instanceof Error ? err.message : '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (screenshotId: string) => {
    if (!confirm('이 스크린샷을 삭제하시겠습니까?')) return;

    try {
      const response = await fetch(
        `/api/projects/${projectId}/screenshots/${screenshotId}`,
        { method: 'DELETE' }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '삭제에 실패했습니다.');
      }

      await fetchScreenshots(); // 목록 새로고침
    } catch (err) {
      console.error('Error deleting screenshot:', err);
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    }
  };

  const handleUpdate = async (screenshotId: string, updates: Partial<Screenshot>) => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/screenshots/${screenshotId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '업데이트에 실패했습니다.');
      }

      await fetchScreenshots(); // 목록 새로고침
    } catch (err) {
      console.error('Error updating screenshot:', err);
      alert(err instanceof Error ? err.message : '업데이트에 실패했습니다.');
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="aspect-[4/3] bg-gray-200 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 헤더 및 업로드 버튼 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          스크린샷 갤러리 ({screenshots.length})
        </h3>
        <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
          {uploading ? '업로드 중...' : '업로드'}
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFileUpload(e.target.files)}
            disabled={uploading}
          />
        </label>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* 갤러리 그리드 */}
      {screenshots.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
          <p className="text-gray-500 mb-4">아직 스크린샷이 없습니다.</p>
          <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer inline-block">
            첫 스크린샷 업로드
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {screenshots.map((screenshot) => (
            <ScreenshotItem
              key={screenshot.id}
              screenshot={screenshot}
              projectId={projectId}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

