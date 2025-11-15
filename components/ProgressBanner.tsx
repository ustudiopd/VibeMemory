'use client';

import { useEffect, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';

interface ProgressCounters {
  md_total: number;
  md_indexed: number;
  chunk_total: number;
  review_done: number;
  review_total: number;
}

interface PhaseInfo {
  phase: string;
  status: string;
}

interface ProgressBannerProps {
  projectId: string;
}

const phaseLabels: Record<string, string> = {
  indexing: '인덱싱',
  embedding: '임베딩',
  review: 'AI 리뷰',
  done: '완료',
  failed: '실패',
};

export default function ProgressBanner({ projectId }: ProgressBannerProps) {
  const [phase, setPhase] = useState<PhaseInfo>({ phase: 'indexing', status: 'running' });
  const [counters, setCounters] = useState<ProgressCounters>({
    md_total: 0,
    md_indexed: 0,
    chunk_total: 0,
    review_done: 0,
    review_total: 4,  // 프로젝트 개요 포함하여 4단계
  });
  const [isConnected, setIsConnected] = useState(false);

  // SSE 연결 (초기 폴링 제거, SSE만 사용)
  useEffect(() => {
    let abortController: AbortController | null = null;
    let closed = false;
    let isCompleted = false; // 완료 상태 추적

    const connectSSE = () => {
      if (closed || isCompleted) return;
      
      abortController = new AbortController();

      fetchEventSource(`/api/projects/${projectId}/progress/stream`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
        signal: abortController.signal,
        async onopen() {
          setIsConnected(true);
          console.log('SSE connection opened');
        },
        onmessage(event) {
          try {
            const data = JSON.parse(event.data);

            if (event.event === 'ready') {
              // 연결 준비 완료
              console.log('SSE ready');
            } else if (event.event === 'phase') {
              setPhase(data);
              // 완료 상태 확인
              if (data.status === 'completed' || data.status === 'failed') {
                isCompleted = true;
              }
            } else if (event.event === 'counters') {
              setCounters((prev) => ({ ...prev, ...data }));
            } else if (event.event === 'done') {
              setPhase(data);
              setIsConnected(false);
              // 완료 또는 실패 시 재연결하지 않음
              if (data.status === 'completed' || data.status === 'failed') {
                isCompleted = true;
                closed = true;
                if (abortController) {
                  abortController.abort();
                }
              }
            }
          } catch (error) {
            console.error('Error parsing SSE message:', error);
          }
        },
        onerror(error) {
          console.error('SSE error:', error);
          setIsConnected(false);
          // 완료된 프로젝트는 재연결하지 않음
          if (!closed && !isCompleted) {
            // 재연결 시도 (3초 후) - 너무 빠른 재연결 방지
            setTimeout(() => {
              if (!closed && !isCompleted && abortController && !abortController.signal.aborted) {
                connectSSE();
              }
            }, 3000);
          }
        },
        onclose() {
          setIsConnected(false);
          console.log('SSE connection closed');
          // 완료된 프로젝트는 재연결하지 않음
          if (!closed && !isCompleted) {
            // 재연결 시도 (3초 후) - 너무 빠른 재연결 방지
            setTimeout(() => {
              if (!closed && !isCompleted) {
                connectSSE();
              }
            }, 3000);
          }
        },
      });
    };

    connectSSE();

    return () => {
      closed = true;
      if (abortController) {
        abortController.abort();
      }
    };
  }, [projectId]);

  const phaseLabel = phaseLabels[phase.phase] || phase.phase;
  const isRunning = phase.status === 'running';
  const isCompleted = phase.status === 'completed';
  const isFailed = phase.status === 'failed';

  return (
    <div className="bg-white rounded-none md:rounded-lg shadow p-3 md:p-6 mb-4 md:mb-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0 pr-2">
          <h3 className="text-base md:text-lg font-semibold text-gray-900">
            {isRunning && '🔄 '}
            {isCompleted && '✅ '}
            {isFailed && '❌ '}
            {isCompleted ? '완료되었습니다' : isFailed ? '실패했습니다' : `현재 ${phaseLabel} 중입니다`}
          </h3>
          {counters.md_total > 0 && (
            <p className="text-xs md:text-sm text-gray-600 mt-1 whitespace-nowrap overflow-hidden text-ellipsis">
              {counters.md_total}개 파일 찾았습니다
            </p>
          )}
        </div>
        <div className="flex items-center space-x-1 md:space-x-2 flex-shrink-0">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
            }`}
            title={isConnected ? '실시간 연결됨' : '연결 끊김'}
          />
          <span className="text-[10px] md:text-xs text-gray-500 whitespace-nowrap">
            {isConnected ? '실시간' : '오프라인'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* P1: 인덱싱 */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700">P1: 인덱싱</h4>
            <span className="text-xs text-gray-500">
              {counters.md_indexed} / {counters.md_total}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${
                  counters.md_total > 0
                    ? (counters.md_indexed / counters.md_total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>

        {/* P2: 임베딩 */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700">P2: 임베딩</h4>
            <span className="text-xs text-gray-500">{counters.chunk_total} 청크</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-purple-600 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${Math.min((counters.chunk_total / 100) * 100, 100)}%`,
              }}
            />
          </div>
        </div>

        {/* P3: AI 리뷰 */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700">P3: AI 리뷰</h4>
            <span className="text-xs text-gray-500">
              {counters.review_done} / {counters.review_total}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-600 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${
                  counters.review_total > 0
                    ? (counters.review_done / counters.review_total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

