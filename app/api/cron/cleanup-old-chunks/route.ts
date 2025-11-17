import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Node.js 런타임 사용
export const runtime = 'nodejs';
export const maxDuration = 300; // 5분 (Pro 플랜 기준)

const CRON_SECRET = process.env.CRON_SECRET;
const RETENTION_DAYS = 30; // 30일 이상 된 old 청크만 삭제

/**
 * Old 청크 정리 크론 작업
 * 야간 배치로 is_current=false인 오래된 청크를 정리합니다.
 * 
 * GET /api/cron/cleanup-old-chunks
 */
export async function GET(request: NextRequest) {
  // CRON_SECRET 검증 (운영 환경)
  if (CRON_SECRET) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
  } else {
    console.log('[CLEANUP] CRON_SECRET not set, allowing request (development mode)');
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffDateStr = cutoffDate.toISOString();

    console.log(`[CLEANUP] Starting cleanup of old chunks (older than ${RETENTION_DAYS} days, before ${cutoffDateStr})`);

    // 1. is_current=false이고 오래된 청크 조회
    const { data: oldChunks, error: fetchError } = await supabaseAdmin
      .from('repo_file_chunks')
      .select('id, repo_file_id, updated_at')
      .eq('is_current', false)
      .lt('updated_at', cutoffDateStr)
      .limit(1000); // 한 번에 최대 1000개 처리 (배치 처리)

    if (fetchError) {
      console.error('[CLEANUP] Error fetching old chunks:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch old chunks', details: fetchError },
        { status: 500 }
      );
    }

    if (!oldChunks || oldChunks.length === 0) {
      return NextResponse.json({
        message: 'No old chunks to cleanup',
        deleted: 0,
      });
    }

    console.log(`[CLEANUP] Found ${oldChunks.length} old chunks to delete`);

    // 2. 청크 삭제
    const chunkIds = oldChunks.map(chunk => chunk.id);
    const { error: deleteError, count } = await supabaseAdmin
      .from('repo_file_chunks')
      .delete()
      .in('id', chunkIds);

    if (deleteError) {
      console.error('[CLEANUP] Error deleting old chunks:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete old chunks', details: deleteError },
        { status: 500 }
      );
    }

    console.log(`[CLEANUP] Successfully deleted ${count || oldChunks.length} old chunks`);

    // 3. (선택) 더 이상 참조되지 않는 repo_files 정리
    // is_current=false이고 청크가 없는 파일 찾기
    // 서브쿼리로 청크가 있는 파일 ID 목록 가져오기
    const { data: filesWithChunks, error: chunksError } = await supabaseAdmin
      .from('repo_file_chunks')
      .select('repo_file_id')
      .limit(10000); // 최대 10000개 (실제로는 더 많을 수 있지만 배치 처리)

    let orphanedCount = 0;
    if (chunksError) {
      console.warn('[CLEANUP] Error fetching files with chunks, skipping orphaned files cleanup:', chunksError);
    } else {
      const fileIdsWithChunks = new Set(
        filesWithChunks?.map((c: any) => c.repo_file_id) || []
      );

      // is_current=false이고 청크가 없는 파일 찾기
      const { data: orphanedFiles, error: orphanError } = await supabaseAdmin
        .from('repo_files')
        .select('id')
        .eq('is_current', false)
        .limit(1000); // 배치 처리

      if (orphanError) {
        console.warn('[CLEANUP] Error fetching orphaned files:', orphanError);
      } else if (orphanedFiles && orphanedFiles.length > 0) {
        // 청크가 없는 파일만 필터링
        const filesToDelete = orphanedFiles
          .filter((f: any) => !fileIdsWithChunks.has(f.id))
          .map((f: any) => f.id);

        if (filesToDelete.length > 0) {
          const { error: deleteFilesError, count: deletedFilesCount } = await supabaseAdmin
            .from('repo_files')
            .delete()
            .in('id', filesToDelete);

          if (!deleteFilesError) {
            orphanedCount = deletedFilesCount || 0;
            console.log(`[CLEANUP] Deleted ${orphanedCount} orphaned repo_files`);
          } else {
            console.warn('[CLEANUP] Error deleting orphaned files:', deleteFilesError);
          }
        }
      }
    }

    return NextResponse.json({
      message: 'Cleanup completed',
      deletedChunks: count || oldChunks.length,
      deletedFiles: orphanedCount,
      cutoffDate: cutoffDateStr,
    });
  } catch (error) {
    console.error('[CLEANUP] Error during cleanup:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

