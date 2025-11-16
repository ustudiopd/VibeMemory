'use client';

import { useState } from 'react';

interface CommentFormProps {
  projectId: string;
  screenshotId: string;
  onCommentAdded: () => void;
}

export default function CommentForm({
  projectId,
  screenshotId,
  onCommentAdded,
}: CommentFormProps) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/screenshots/${screenshotId}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content.trim() }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '댓글 작성에 실패했습니다.');
      }

      setContent(''); // 입력 필드 초기화
      onCommentAdded(); // 부모 컴포넌트에 알림
    } catch (err) {
      console.error('Error submitting comment:', err);
      alert(err instanceof Error ? err.message : '댓글 작성에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="댓글을 입력하세요..."
        rows={2}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
        disabled={submitting}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSubmit(e);
          }
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Ctrl/Cmd + Enter로 전송
        </span>
        <button
          type="submit"
          disabled={!content.trim() || submitting}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? '작성 중...' : '작성'}
        </button>
      </div>
    </form>
  );
}

