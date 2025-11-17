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
  is_primary: boolean;
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
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Signed URL 가져오기
  useEffect(() => {
    const fetchImageUrl = async () => {
      if (!screenshot.storage_path) {
        setImageError(true);
        return;
      }

      try {
        setImageError(false);
        const response = await fetch(
          `/api/projects/${projectId}/screenshots/${screenshot.id}/url`
        );
        const data = await response.json();
        if (response.ok && data.url) {
          setImageUrl(data.url);
        } else {
          console.error('Error fetching image URL:', data.error);
          setImageError(true);
        }
      } catch (err) {
        console.error('Error fetching image URL:', err);
        setImageError(true);
      }
    };

    fetchImageUrl();
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

  const handleTogglePrimary = async (e: React.MouseEvent) => {
    e.stopPropagation(); // 이미지 클릭 이벤트 방지
    const newIsPrimary = !screenshot.is_primary;
    onUpdate(screenshot.id, { is_primary: newIsPrimary });
  };

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
        {/* 이미지 */}
        <div
          className="aspect-[4/3] bg-gray-100 cursor-pointer relative group overflow-hidden"
          onClick={() => setShowModal(true)}
        >
          {/* 배경색을 항상 밝게 유지 - 이미지 뒤에 항상 표시 */}
          <div className="absolute inset-0 bg-gray-100 z-0"></div>
          
          {/* 대표 이미지 별표시 - 모든 이미지에 표시 */}
          <button
            onClick={handleTogglePrimary}
            className="absolute top-2 right-2 z-30 p-1 hover:opacity-80 transition-opacity"
            title={screenshot.is_primary ? '대표 이미지 해제' : '대표 이미지로 설정'}
          >
            {screenshot.is_primary ? (
              // 선택된 별: 채워진 2D 별
              <svg
                className="w-5 h-5 text-yellow-400"
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ) : (
              // 선택 안된 별: 테두리만 있는 2D 별
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                />
              </svg>
            )}
          </button>
          
          {imageError || !imageUrl ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-100 relative z-10">
              <div className="text-gray-400 text-sm">
                {imageError ? '이미지 로드 실패' : '로딩 중...'}
              </div>
            </div>
          ) : (
            <>
              <img
                key={imageUrl}
                src={imageUrl}
                alt={screenshot.alt_text || screenshot.file_name}
                className="w-full h-full object-cover relative z-10"
                loading="lazy"
                decoding="async"
                onLoad={() => {
                  setImageLoaded(true);
                  setImageError(false);
                }}
                onError={(e) => {
                  console.error('Image load error:', e);
                  setImageError(true);
                }}
              />
              {/* 호버 오버레이 - opacity-0 기본, hover 시에만 표시 */}
              <div className="absolute inset-0 z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 flex items-center justify-center">
                <span className="text-white opacity-0 group-hover:opacity-100 text-sm font-medium">
                  클릭하여 확대
                </span>
              </div>
            </>
          )}
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
            {imageError || !imageUrl ? (
              <div className="bg-white rounded-lg p-8 text-center">
                <p className="text-gray-600">이미지를 불러올 수 없습니다.</p>
              </div>
            ) : imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt={screenshot.alt_text || screenshot.file_name}
                  className="max-w-full max-h-[90vh] object-contain rounded-lg bg-white"
                  onClick={(e) => e.stopPropagation()}
                  onError={(e) => {
                    console.error('Modal image load error:', e);
                    setImageError(true);
                  }}
                />
                {screenshot.caption && (
                  <div className="mt-4 text-white text-center">
                    <p className="text-lg">{screenshot.caption}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white rounded-lg p-8 text-center">
                <p className="text-gray-600">로딩 중...</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

