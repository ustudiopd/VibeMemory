'use client';

import { useState, useEffect } from 'react';
import CommentList from './CommentList';

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

interface ScreenshotItemProps {
  screenshot: Screenshot;
  projectId: string;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Screenshot>) => void;
}

export default function ScreenshotItem({
  screenshot,
  projectId,
  onDelete,
  onUpdate,
}: ScreenshotItemProps) {
  const [showModal, setShowModal] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionValue, setCaptionValue] = useState(screenshot.caption || '');
  const [editingAlt, setEditingAlt] = useState(false);
  const [altValue, setAltValue] = useState(screenshot.alt_text || '');

  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Signed URL 가져오기
  useEffect(() => {
    const fetchImageUrl = async () => {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/screenshots/${screenshot.id}/url`
        );
        const data = await response.json();
        if (response.ok && data.url) {
          setImageUrl(data.url);
        }
      } catch (err) {
        console.error('Error fetching image URL:', err);
      }
    };

    if (screenshot.storage_path) {
      fetchImageUrl();
    }
  }, [projectId, screenshot.id, screenshot.storage_path]);

  const handleCaptionSave = () => {
    if (captionValue !== screenshot.caption) {
      onUpdate(screenshot.id, { caption: captionValue || null });
    }
    setEditingCaption(false);
  };

  const handleAltSave = () => {
    if (altValue !== screenshot.alt_text) {
      onUpdate(screenshot.id, { alt_text: altValue || null });
    }
    setEditingAlt(false);
  };

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
        {/* 이미지 */}
        <div
          className="aspect-[4/3] bg-gray-100 cursor-pointer relative group"
          onClick={() => setShowModal(true)}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={screenshot.alt_text || screenshot.file_name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              이미지 로드 실패
            </div>
          )}
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-opacity flex items-center justify-center">
            <span className="text-white opacity-0 group-hover:opacity-100 text-sm font-medium">
              클릭하여 확대
            </span>
          </div>
        </div>

        {/* 캡션 및 액션 */}
        <div className="p-3 space-y-2">
          {/* 캡션 */}
          {editingCaption ? (
            <input
              type="text"
              value={captionValue}
              onChange={(e) => setCaptionValue(e.target.value)}
              onBlur={handleCaptionSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCaptionSave();
                if (e.key === 'Escape') {
                  setCaptionValue(screenshot.caption || '');
                  setEditingCaption(false);
                }
              }}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          ) : (
            <p
              className="text-sm text-gray-700 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
              onClick={() => setEditingCaption(true)}
            >
              {screenshot.caption || '캡션 추가 (클릭하여 편집)'}
            </p>
          )}

          {/* Alt 텍스트 */}
          {editingAlt ? (
            <input
              type="text"
              value={altValue}
              onChange={(e) => setAltValue(e.target.value)}
              onBlur={handleAltSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAltSave();
                if (e.key === 'Escape') {
                  setAltValue(screenshot.alt_text || '');
                  setEditingAlt(false);
                }
              }}
              className="w-full px-2 py-1 text-xs text-gray-500 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Alt 텍스트"
              autoFocus
            />
          ) : (
            <p
              className="text-xs text-gray-500 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
              onClick={() => setEditingAlt(true)}
            >
              {screenshot.alt_text || 'Alt 텍스트 추가 (클릭하여 편집)'}
            </p>
          )}

          {/* 액션 버튼 */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <button
              onClick={() => setShowComments(!showComments)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              {showComments ? '댓글 숨기기' : '댓글 보기'}
            </button>
            <button
              onClick={() => onDelete(screenshot.id)}
              className="text-xs text-red-600 hover:text-red-800"
            >
              삭제
            </button>
          </div>

          {/* 댓글 섹션 */}
          {showComments && (
            <div className="pt-2 border-t border-gray-100">
              <CommentList
                projectId={projectId}
                screenshotId={screenshot.id}
              />
            </div>
          )}
        </div>
      </div>

      {/* 모달 (확대 이미지) */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div className="max-w-4xl max-h-full relative">
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 text-white bg-black bg-opacity-50 rounded-full p-2 hover:bg-opacity-75 z-10"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            {imageUrl && (
              <img
                src={imageUrl}
                alt={screenshot.alt_text || screenshot.file_name}
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            {screenshot.caption && (
              <div className="mt-4 text-white text-center">
                <p className="text-lg">{screenshot.caption}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

