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

  // 초기 데이터 로드 (폴링 API 사용)
  useEffect(() => {
    const fetchInitialProgress = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/progress`);
        if (response.ok) {
          const data = await response.json();
          
          // 기존 get_project_progress RPC 결과를 새로운 형식으로 변환
          if (data.P1) {
            setCounters((prev) => ({
              ...prev,
              md_total: data.P1.total_md || 0,
              md_indexed: data.P1.indexed_md || 0,
            }));
          }
          if (data.P2) {
            setCounters((prev) => ({
              ...prev,
              chunk_total: data.P2.embedded_chunks || 0,
            }));
          }
          if (data.P3) {
            setCounters((prev) => ({
              ...prev,
              review_done: data.P3.core_done || 0,
              review_total: data.P3.core_total || 4,  // 프로젝트 개요 포함하여 4단계
            }));
          }
        }
      } catch (error) {
        console.error('Error fetching initial progress:', error);
      }
    };

    fetchInitialProgress();
  }, [projectId]);

  useEffect(() => {
    let abortController: AbortController | null = null;

    const connectSSE = () => {
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

            if (event.event === 'phase') {
              setPhase(data);
            } else if (event.event === 'counters') {
              setCounters((prev) => ({ ...prev, ...data }));
            } else if (event.event === 'done') {
              setPhase(data);
              setIsConnected(false);
            }
          } catch (error) {
            console.error('Error parsing SSE message:', error);
          }
        },
        onerror(error) {
          console.error('SSE error:', error);
          setIsConnected(false);
          // 재연결 시도 (2초 후)
          setTimeout(() => {
            if (abortController && !abortController.signal.aborted) {
              connectSSE();
            }
          }, 2000);
        },
        onclose() {
          setIsConnected(false);
          console.log('SSE connection closed');
        },
      });
    };

    connectSSE();

    return () => {
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
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {isRunning && '🔄 '}
            {isCompleted && '✅ '}
            {isFailed && '❌ '}
            {isCompleted ? '완료되었습니다' : isFailed ? '실패했습니다' : `현재 ${phaseLabel} 중입니다`}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            {counters.md_total > 0 && `${counters.md_total}개의 MD 파일을 찾았습니다.`}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
            }`}
            title={isConnected ? '실시간 연결됨' : '연결 끊김'}
          />
          <span className="text-xs text-gray-500">
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

