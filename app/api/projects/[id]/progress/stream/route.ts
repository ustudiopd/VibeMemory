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

  // SSE 스트림 생성 (55초 롤링)
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: string, data: any) => {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      // 즉시 연결 알림
      sendEvent('ready', { ok: true });

      // 하트비트 (15초마다)
      const hb = setInterval(() => {
        controller.enqueue(encoder.encode(':\n\n'));
      }, 15000);

      // 55초 동안만 실행 (타임아웃 방지)
      const endAt = Date.now() + 55_000;

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

      // 주기적으로 진행 상태 확인 (5초마다, 55초까지) - 2초에서 5초로 변경하여 DB 부하 감소
      const interval = setInterval(async () => {
        try {
          // 55초 경과 확인
          if (Date.now() >= endAt) {
            clearInterval(interval);
            clearInterval(hb);
            sendEvent('done', { message: 'Stream ended (55s limit)' });
            controller.close();
            return;
          }

          const { data: latestRun } = await supabaseAdmin
            .from('ingestion_runs')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latestRun) {
            // 완료 또는 실패 시 스트림 종료 (RPC 호출 전에 확인하여 불필요한 호출 방지)
            if (latestRun.status === 'completed' || latestRun.status === 'failed') {
              // 완료된 경우 scan_progress에서 최종 값 가져오기
              const { data: progress } = await supabaseAdmin
                .from('scan_progress')
                .select('*')
                .eq('run_id', latestRun.id)
                .maybeSingle();

              if (progress) {
                sendEvent('counters', {
                  md_total: progress.md_total,
                  md_indexed: progress.md_indexed,
                  chunk_total: progress.chunk_total,
                  review_done: progress.review_done,
                  review_total: progress.review_total,
                });
              }

              sendEvent('phase', {
                phase: latestRun.phase,
                status: latestRun.status,
              });
              sendEvent('done', {
                status: latestRun.status,
                phase: latestRun.phase,
              });
              clearInterval(interval);
              clearInterval(hb);
              controller.close();
              return;
            }

            // 진행 중인 경우에만 scan_progress에서 가져오기 (RPC 호출보다 빠름)
            const { data: progress } = await supabaseAdmin
              .from('scan_progress')
              .select('*')
              .eq('run_id', latestRun.id)
              .maybeSingle();

            // Phase 업데이트
            sendEvent('phase', {
              phase: latestRun.phase,
              status: latestRun.status,
            });

            // 카운터 업데이트
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
            // ingestion_runs가 없으면 기존 get_project_progress RPC 사용 (fallback)
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
                clearInterval(hb);
                controller.close();
                return;
              }
            }
          }
        } catch (error) {
          console.error('Error in SSE stream:', error);
          // 에러가 발생해도 스트림을 유지 (재연결 시도)
        }
      }, 5000); // 2초에서 5초로 변경

      // 클라이언트 연결 종료 시 정리
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clearInterval(hb);
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

