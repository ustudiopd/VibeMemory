'use client';

import { useState, useEffect } from 'react';
import CommentForm from './CommentForm';

interface Comment {
  id: string;
  screenshot_id: string;
  project_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

interface CommentListProps {
  projectId: string;
  screenshotId: string;
}

export default function CommentList({ projectId, screenshotId }: CommentListProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchComments = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/projects/${projectId}/screenshots/${screenshotId}/comments?limit=50`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '댓글을 불러올 수 없습니다.');
      }

      setComments(data.comments || []);
    } catch (err) {
      console.error('Error fetching comments:', err);
      setError(err instanceof Error ? err.message : '댓글을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId && screenshotId) {
      fetchComments();
    }
  }, [projectId, screenshotId]);

  const handleCommentAdded = () => {
    fetchComments(); // 댓글 목록 새로고침
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm('이 댓글을 삭제하시겠습니까?')) return;

    try {
      const response = await fetch(
        `/api/projects/${projectId}/screenshots/${screenshotId}/comments/${commentId}`,
        { method: 'DELETE' }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '삭제에 실패했습니다.');
      }

      await fetchComments(); // 목록 새로고침
    } catch (err) {
      console.error('Error deleting comment:', err);
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 py-2">댓글을 불러오는 중...</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500 py-2">{error}</div>;
  }

  return (
    <div className="space-y-3">
      {/* 댓글 목록 */}
      {comments.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">아직 댓글이 없습니다.</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="bg-gray-50 rounded-lg p-2 text-sm"
            >
              <p className="text-gray-700 whitespace-pre-wrap">{comment.content}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-500">
                  {new Date(comment.created_at).toLocaleString('ko-KR', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <button
                  onClick={() => handleDelete(comment.id)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 댓글 작성 폼 */}
      <CommentForm
        projectId={projectId}
        screenshotId={screenshotId}
        onCommentAdded={handleCommentAdded}
      />
    </div>
  );
}

