import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  // 시스템 사용자 확인
  const user = await getSystemUserFromSupabase();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 프로젝트 소유권 확인
  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('id, owner_id')
    .eq('owner_id', user.id)
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    return new Response('Project not found', { status: 404 });
  }

  // SSE 스트림 생성
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: string, data: any) => {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      // 초기 상태 전송
      const { data: latestRun } = await supabaseAdmin
        .from('ingestion_runs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRun) {
        const { data: progress } = await supabaseAdmin
          .from('scan_progress')
          .select('*')
          .eq('run_id', latestRun.id)
          .maybeSingle();

        sendEvent('phase', {
          phase: latestRun.phase,
          status: latestRun.status,
        });

        if (progress) {
          sendEvent('counters', {
            md_total: progress.md_total,
            md_indexed: progress.md_indexed,
            chunk_total: progress.chunk_total,
            review_done: progress.review_done,
            review_total: progress.review_total,
          });
        }
      } else {
        // ingestion_runs가 없으면 기존 get_project_progress RPC 사용
        const { data: progressData } = await supabaseAdmin.rpc('get_project_progress', {
          p_project_id: projectId,
        });

        if (progressData) {
          sendEvent('phase', {
            phase: progressData.P3?.core_done === progressData.P3?.core_total ? 'done' : 'indexing',
            status: progressData.P3?.core_done === progressData.P3?.core_total ? 'completed' : 'running',
          });

          sendEvent('counters', {
            md_total: progressData.P1?.total_md || 0,
            md_indexed: progressData.P1?.indexed_md || 0,
            chunk_total: progressData.P2?.embedded_chunks || 0,
            review_done: progressData.P3?.core_done || 0,
            review_total: progressData.P3?.core_total || 4,  // 프로젝트 개요 포함하여 4단계
          });
        }
      }

      // 주기적으로 진행 상태 확인 (2초마다)
      const interval = setInterval(async () => {
        try {
          const { data: latestRun } = await supabaseAdmin
            .from('ingestion_runs')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latestRun) {
            // 실제 진행 상황을 get_project_progress RPC로 가져와서 동기화
            const { data: progressData } = await supabaseAdmin.rpc('get_project_progress', {
              p_project_id: projectId,
            });

            // Phase 업데이트
            sendEvent('phase', {
              phase: latestRun.phase,
              status: latestRun.status,
            });

            // 카운터 업데이트 (실제 RPC 값 사용)
            if (progressData) {
              sendEvent('counters', {
                md_total: progressData.P1?.total_md || 0,
                md_indexed: progressData.P1?.indexed_md || 0,
                chunk_total: progressData.P2?.embedded_chunks || 0,
                review_done: progressData.P3?.core_done || 0,
                review_total: progressData.P3?.core_total || 4,  // 프로젝트 개요 포함하여 4단계
              });
            }

            // 완료 또는 실패 시 스트림 종료
            if (latestRun.status === 'completed' || latestRun.status === 'failed') {
              sendEvent('done', {
                status: latestRun.status,
                phase: latestRun.phase,
              });
              clearInterval(interval);
              controller.close();
            }
          } else {
            // ingestion_runs가 없으면 기존 get_project_progress RPC 사용
            const { data: progressData } = await supabaseAdmin.rpc('get_project_progress', {
              p_project_id: projectId,
            });

            if (progressData) {
              const isCompleted = progressData.P3?.core_done === progressData.P3?.core_total;
              
              sendEvent('phase', {
                phase: isCompleted ? 'done' : 'indexing',
                status: isCompleted ? 'completed' : 'running',
              });

              sendEvent('counters', {
                md_total: progressData.P1?.total_md || 0,
                md_indexed: progressData.P1?.indexed_md || 0,
                chunk_total: progressData.P2?.embedded_chunks || 0,
                review_done: progressData.P3?.core_done || 0,
                review_total: progressData.P3?.core_total || 4,  // 프로젝트 개요 포함하여 4단계
              });

              if (isCompleted) {
                sendEvent('done', {
                  status: 'completed',
                  phase: 'done',
                });
                clearInterval(interval);
                controller.close();
              }
            }
          }
        } catch (error) {
          console.error('Error in SSE stream:', error);
          // 에러가 발생해도 스트림을 유지 (재연결 시도)
        }
      }, 2000);

      // 클라이언트 연결 종료 시 정리
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

