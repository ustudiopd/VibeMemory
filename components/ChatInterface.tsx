'use client';

import { useRef, useEffect, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import ChatMarkdown from './ChatMarkdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{
    file_path: string;
    score: number;
    chunk_id: string;
  }>;
}

interface ChatInterfaceProps {
  projectId?: string;
}

export default function ChatInterface({ projectId }: ChatInterfaceProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sources, setSources] = useState<Array<{ file_path: string; score: number; chunk_id: string }>>([]);

  const apiEndpoint = projectId
    ? `/api/projects/${projectId}/chat`
    : '/api/chat';

  // 세션 생성
  const createSession = async () => {
    if (!projectId) return null;

    try {
      const response = await fetch(`/api/projects/${projectId}/chat/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = await response.json();
        return data.sessionId;
      }
    } catch (error) {
      console.error('[ChatInterface] Error creating session:', error);
    }
    return null;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    // 사용자 메시지 추가
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
    };
    setMessages((prev) => [...prev, userMsg]);

    // 세션이 없으면 생성
    let sessionId = currentSessionId;
    if (!sessionId && projectId) {
      sessionId = await createSession();
      if (sessionId) {
        setCurrentSessionId(sessionId);
      }
    }

    // Assistant 메시지 플레이스홀더 추가
    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
    };
    setMessages((prev) => [...prev, assistantMsg]);

    // SSE 스트림 구독
    try {
      await fetchEventSource(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          sessionId,
          message: userMessage,
        }),
        onmessage(ev) {
          if (ev.event === 'token') {
            // 토큰 추가 - 서버에서 JSON.stringify로 보냈으므로 무조건 파싱
            let tokenText = ev.data;
            try {
              tokenText = JSON.parse(ev.data); // tokenText 안의 \n이 유지됨
            } catch {
              // 파싱 실패 시 그대로 사용 (하위 호환성)
            }
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? { ...msg, content: msg.content + tokenText }
                  : msg
              )
            );
          } else if (ev.event === 'sources') {
            // 출처 정보 저장
            try {
              const sourcesData = JSON.parse(ev.data);
              setSources(sourcesData);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, sources: sourcesData }
                    : msg
                )
              );
            } catch (error) {
              console.error('[ChatInterface] Error parsing sources:', error);
            }
          } else if (ev.event === 'done') {
            setIsLoading(false);
          } else if (ev.event === 'error') {
            try {
              const errorData = JSON.parse(ev.data);
              console.error('[ChatInterface] Stream error:', errorData);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: msg.content + '\n\n[오류 발생: ' + errorData.error + ']' }
                    : msg
                )
              );
            } catch (error) {
              console.error('[ChatInterface] Error parsing error event:', error);
            }
            setIsLoading(false);
          }
        },
        onerror(err) {
          console.error('[ChatInterface] Fetch error:', err);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + '\n\n[연결 오류가 발생했습니다.]' }
                : msg
            )
          );
          setIsLoading(false);
          throw err; // 재시도 방지
        },
      });
    } catch (error) {
      console.error('[ChatInterface] Error:', error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, content: msg.content + '\n\n[오류가 발생했습니다. 다시 시도해주세요.]' }
            : msg
        )
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white w-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-4 w-full">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <p>질문을 입력하여 프로젝트에 대해 물어보세요.</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id}>
              <div
                className={`flex ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-4xl px-4 py-3 rounded-lg ${
                    message.role === 'user'
                      ? 'bg-slate-600 text-white'
                      : 'bg-slate-100 text-slate-900'
                  }`}
                  style={{ fontWeight: 'normal' }} // 상위에서 font-weight 상속 방지
                >
                  {message.role === 'assistant' ? (
                    <ChatMarkdown content={message.content || ''} />
                  ) : (
                    <p className="whitespace-pre-wrap font-normal">{message.content}</p>
                  )}
                </div>
              </div>
              {/* 출처 표시 */}
              {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                <div className="mt-2 ml-4">
                  <div className="text-xs text-gray-500 mb-1">참고 출처:</div>
                  <div className="flex flex-wrap gap-2">
                    {message.sources.map((source, idx) => (
                      <a
                        key={idx}
                        href={`#${source.file_path}`}
                        className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                        title={`유사도: ${source.score.toFixed(3)}`}
                      >
                        {source.file_path.split('/').pop()}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-900 px-4 py-2 rounded-lg">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="border-t p-4 md:p-6 w-full bg-white safe-bottom">
        <div className="flex space-x-2 w-full">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="질문을 입력하세요..."
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px] touch-manipulation"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 md:px-6 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 active:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px] touch-manipulation"
          >
            전송
          </button>
        </div>
      </form>
    </div>
  );
}
