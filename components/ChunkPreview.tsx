'use client';

import { X } from 'lucide-react';

interface ChunkPreviewProps {
  chunk: {
    id: string;
    content: string;
    file_path: string;
    chunk_index: number;
  } | null;
  onClose: () => void;
}

export default function ChunkPreview({ chunk, onClose }: ChunkPreviewProps) {
  if (!chunk) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">청크 내용</h3>
            <p className="text-sm text-gray-500 mt-1">
              {chunk.file_path} (청크 #{chunk.chunk_index})
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="닫기"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded">
            {chunk.content}
          </pre>
        </div>
      </div>
    </div>
  );
}

