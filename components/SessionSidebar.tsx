'use client';

import { useEffect, useState } from 'react';

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface SessionSidebarProps {
  projectId: string;
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
}

export default function SessionSidebar({
  projectId,
  currentSessionId,
  onSessionSelect,
  onNewSession,
}: SessionSidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // 세션 목록 불러오기
  const loadSessions = async () => {
    if (!projectId) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/chat/sessions?limit=30`);
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error('[SessionSidebar] Error loading sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, [projectId]);

  // 세션 선택 시 목록 새로고침
  useEffect(() => {
    if (currentSessionId) {
      loadSessions();
    }
  }, [currentSessionId]);

  // 검색 필터링
  const filteredSessions = sessions.filter((session) =>
    session.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 날짜 포맷팅
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // 날짜/시간 형식
    const dateTimeStr = date.toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // 상대 시간
    let relativeTime = '';
    if (diffMins < 1) relativeTime = '방금 전';
    else if (diffMins < 60) relativeTime = `${diffMins}분 전`;
    else if (diffHours < 24) relativeTime = `${diffHours}시간 전`;
    else if (diffDays < 7) relativeTime = `${diffDays}일 전`;
    else relativeTime = '';

    return relativeTime ? `${dateTimeStr} (${relativeTime})` : dateTimeStr;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200 w-full md:w-64">
      {/* 헤더 */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">대화 목록</h3>
          <button
            onClick={onNewSession}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            title="새 대화 시작"
          >
            + 새로
          </button>
        </div>
        {/* 검색 */}
        <input
          type="text"
          placeholder="대화 검색..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* 세션 목록 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm text-gray-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
            로딩 중...
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            {searchQuery ? '검색 결과가 없습니다.' : '대화가 없습니다.'}
          </div>
        ) : (
          <div className="p-2">
            {filteredSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSessionSelect(session.id)}
                className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
                  currentSessionId === session.id
                    ? 'bg-blue-100 text-blue-900 border border-blue-300'
                    : 'bg-white hover:bg-gray-100 text-gray-900 border border-transparent'
                }`}
              >
                <div className="text-xs text-gray-500">
                  {formatDate(session.updated_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

