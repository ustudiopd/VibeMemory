import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * 임포트 잠금 상태 초기화 API
 * 특정 리포지토리 또는 모든 임포트 잠금을 초기화합니다.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { repo_owner, repo_name } = body;

    let deletedCount = 0;

    try {
      if (repo_owner && repo_name) {
        // 특정 리포지토리의 잠금만 삭제
        const jobNames = [
          `import:${repo_owner}/${repo_name}`,
          `rescan:${repo_owner}/${repo_name}`,
          `webhook:${repo_owner}/${repo_name}`,
        ];

        for (const jobName of jobNames) {
          const { data, error } = await supabaseAdmin
            .from('job_locks')
            .delete()
            .eq('job_name', jobName)
            .select();

          if (error) {
            console.error(`Error deleting lock ${jobName}:`, error);
          } else {
            deletedCount += data?.length || 0;
            console.log(`Deleted lock: ${jobName}`);
          }
        }
      } else {
        // 모든 임포트 관련 잠금 삭제 (import:로 시작하는 잠금)
        // 먼저 조회 시도
        const { data: allLocks, error: fetchError } = await supabaseAdmin
          .from('job_locks')
          .select('job_name')
          .like('job_name', 'import:%');

        if (fetchError) {
          console.error('Error fetching locks:', fetchError);
          // 조회 실패해도 직접 삭제 시도
          console.log('Attempting direct delete without fetch...');
          const { error: deleteAllError } = await supabaseAdmin
            .from('job_locks')
            .delete()
            .like('job_name', 'import:%');
          
          if (deleteAllError) {
            console.error('Error deleting all import locks:', deleteAllError);
            return NextResponse.json(
              { 
                error: '잠금 조회 및 삭제에 실패했습니다.', 
                details: `조회: ${fetchError.message}, 삭제: ${deleteAllError.message}` 
              },
              { status: 500 }
            );
          }
          // 직접 삭제 성공 (개수는 알 수 없음)
          return NextResponse.json({
            success: true,
            message: '모든 임포트 잠금이 초기화되었습니다.',
            deleted_count: -1, // 개수를 알 수 없음
          });
        }

        if (allLocks && allLocks.length > 0) {
          const jobNames = allLocks.map((lock) => lock.job_name);
          
          for (const jobName of jobNames) {
            const { error: deleteError } = await supabaseAdmin
              .from('job_locks')
              .delete()
              .eq('job_name', jobName);

            if (deleteError) {
              console.error(`Error deleting lock ${jobName}:`, deleteError);
            } else {
              deletedCount++;
              console.log(`Deleted lock: ${jobName}`);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in lock reset operation:', error);
      return NextResponse.json(
        { 
          error: '잠금 초기화 중 오류가 발생했습니다.', 
          details: error instanceof Error ? error.message : 'Unknown error' 
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${deletedCount}개의 잠금이 초기화되었습니다.`,
      deleted_count: deletedCount,
    });
  } catch (error) {
    console.error('Error in POST /api/projects/import/reset-locks:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * 현재 잠금 상태 조회
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const repo_owner = searchParams.get('repo_owner');
    const repo_name = searchParams.get('repo_name');

    let locks;

    try {
      if (repo_owner && repo_name) {
        // 특정 리포지토리의 잠금만 조회
        const jobNames = [
          `import:${repo_owner}/${repo_name}`,
          `rescan:${repo_owner}/${repo_name}`,
          `webhook:${repo_owner}/${repo_name}`,
        ];

        const { data, error } = await supabaseAdmin
          .from('job_locks')
          .select('*')
          .in('job_name', jobNames);

        if (error) {
          console.error('Error fetching locks for specific repo:', error);
          // 테이블이 존재하지 않거나 권한 문제일 수 있음
          return NextResponse.json(
            { 
              error: '잠금 조회에 실패했습니다.', 
              details: error.message,
              hint: 'job_locks 테이블이 존재하는지 확인해주세요.'
            },
            { status: 500 }
          );
        }

        locks = data || [];
      } else {
        // 모든 임포트 관련 잠금 조회
        const { data, error } = await supabaseAdmin
          .from('job_locks')
          .select('*')
          .like('job_name', 'import:%')
          .order('claimed_at', { ascending: false });

        if (error) {
          console.error('Error fetching all import locks:', error);
          // 테이블이 존재하지 않거나 권한 문제일 수 있음
          return NextResponse.json(
            { 
              error: '잠금 조회에 실패했습니다.', 
              details: error.message,
              hint: 'job_locks 테이블이 존재하는지 확인해주세요.'
            },
            { status: 500 }
          );
        }

        locks = data || [];
      }
    } catch (error) {
      console.error('Error in GET /api/projects/import/reset-locks:', error);
      return NextResponse.json(
        {
          error: '잠금 조회 중 오류가 발생했습니다.',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      locks,
      count: locks.length,
    });
  } catch (error) {
    console.error('Error in GET /api/projects/import/reset-locks:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

