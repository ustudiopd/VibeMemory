'use client';

import { useState, useEffect } from 'react';

interface FileInfo {
  id: string;
  path: string;
  sha: string;
  size: number;
  is_current: boolean;
  created_at: string;
  github_url: string;
}

interface FileListPaneProps {
  projectId: string;
}

export default function FileListPane({ projectId }: FileListPaneProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    fetchFiles();
  }, [projectId]);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/files`);
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async (path: string) => {
    if (previewPath === path && previewContent) {
      setPreviewPath(null);
      setPreviewContent(null);
      return;
    }

    setPreviewPath(path);
    setPreviewLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`);
      if (response.ok) {
        const data = await response.json();
        setPreviewContent(data.content);
      }
    } catch (error) {
      console.error('Error fetching file preview:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">파일 목록</h3>
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-500">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">파일 목록</h3>
          <span className="text-sm text-gray-500">{files.length}개 파일</span>
        </div>
      </div>

      <div className="divide-y">
        {files.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            파일이 없습니다.
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              className="p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {file.path}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    SHA: {file.sha.substring(0, 7)}
                  </p>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                  <button
                    onClick={() => handlePreview(file.path)}
                    className="px-3 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                  >
                    {previewPath === file.path ? '닫기' : '미리보기'}
                  </button>
                  <a
                    href={file.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                  >
                    GitHub 열기
                  </a>
                </div>
              </div>

              {previewPath === file.path && (
                <div className="mt-4 border-t pt-4">
                  {previewLoading ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-600 mx-auto"></div>
                    </div>
                  ) : previewContent ? (
                    <div className="bg-gray-50 rounded p-4 max-h-96 overflow-auto">
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                        {previewContent}
                      </pre>
                    </div>
                  ) : (
                    <div className="text-center py-4 text-gray-500 text-sm">
                      미리보기를 불러올 수 없습니다.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

