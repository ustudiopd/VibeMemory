import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { getSystemUser } from '@/lib/system-user';
import { getRepositoryTree } from '@/lib/github';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const diagnostics: any = {
    timestamp: new Date().toISOString(),
    tests: {},
  };

  try {
    const { id: projectId } = await params;

    // 시스템 사용자 확인
    const user = await getSystemUserFromSupabase();
    if (!user) {
      diagnostics.tests.systemUser = {
        status: 'FAILED',
        error: '시스템 사용자를 찾을 수 없습니다.',
      };
      return NextResponse.json(diagnostics, { status: 200 });
    }

    diagnostics.tests.systemUser = {
      status: 'PASSED',
      userId: user.id,
      email: user.email,
    };

    // 프로젝트 정보 가져오기
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, owner_id, repo_owner, repo_name')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      diagnostics.tests.project = {
        status: 'FAILED',
        error: projectError?.message || 'Project not found',
      };
      return NextResponse.json(diagnostics, { status: 200 });
    }

    diagnostics.tests.project = {
      status: 'PASSED',
      projectId: project.id,
      repoOwner: project.repo_owner,
      repoName: project.repo_name,
    };

    // 테스트 1: GitHub API 접근 테스트
    const systemUser = getSystemUser();
    if (!systemUser?.githubAccessToken) {
      diagnostics.tests.githubApi = {
        status: 'FAILED',
        error: 'GitHub Access Token이 설정되지 않았습니다.',
      };
    } else {
      try {
        const tree = await getRepositoryTree(
          systemUser.githubAccessToken,
          project.repo_owner,
          project.repo_name
        );
        diagnostics.tests.githubApi = {
          status: 'PASSED',
          mdFilesFound: tree.length,
          sampleFiles: tree.slice(0, 5).map((f: any) => f.path),
        };
      } catch (error: any) {
        diagnostics.tests.githubApi = {
          status: 'FAILED',
          error: error.message,
          stack: error.stack,
        };
      }
    }

    // 테스트 2: RLS 정책 테스트 - ingestion_runs INSERT
    try {
      const { data: testRun, error: insertError } = await supabaseAdmin
        .from('ingestion_runs')
        .insert({
          project_id: projectId,
          phase: 'indexing',
          status: 'running',
        })
        .select()
        .single();

      if (insertError) {
        diagnostics.tests.rlsIngestionRuns = {
          status: 'FAILED',
          error: insertError.message,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint,
        };
      } else {
        diagnostics.tests.rlsIngestionRuns = {
          status: 'PASSED',
          runId: testRun.id,
        };

        // 테스트 레코드 삭제
        await supabaseAdmin
          .from('ingestion_runs')
          .delete()
          .eq('id', testRun.id);
      }
    } catch (error: any) {
      diagnostics.tests.rlsIngestionRuns = {
        status: 'FAILED',
        error: error.message,
        stack: error.stack,
      };
    }

    // 테스트 3: RLS 정책 테스트 - scan_progress INSERT
    try {
      // 먼저 테스트용 ingestion_run 생성
      const { data: testRun } = await supabaseAdmin
        .from('ingestion_runs')
        .insert({
          project_id: projectId,
          phase: 'indexing',
          status: 'running',
        })
        .select()
        .single();

      if (testRun) {
        const { data: testProgress, error: progressError } = await supabaseAdmin
          .from('scan_progress')
          .insert({
            run_id: testRun.id,
            project_id: projectId,
            md_total: 0,
            md_indexed: 0,
            chunk_total: 0,
            review_done: 0,
            review_total: 3,
          })
          .select()
          .single();

        if (progressError) {
          diagnostics.tests.rlsScanProgress = {
            status: 'FAILED',
            error: progressError.message,
            code: progressError.code,
            details: progressError.details,
            hint: progressError.hint,
          };
        } else {
          diagnostics.tests.rlsScanProgress = {
            status: 'PASSED',
            progressId: testProgress.id,
          };
        }

        // 테스트 레코드 삭제
        await supabaseAdmin
          .from('scan_progress')
          .delete()
          .eq('run_id', testRun.id);
        await supabaseAdmin
          .from('ingestion_runs')
          .delete()
          .eq('id', testRun.id);
      }
    } catch (error: any) {
      diagnostics.tests.rlsScanProgress = {
        status: 'FAILED',
        error: error.message,
        stack: error.stack,
      };
    }

    // 전체 결과 요약
    const allTests = Object.values(diagnostics.tests);
    const passedTests = allTests.filter((t: any) => t.status === 'PASSED').length;
    const failedTests = allTests.filter((t: any) => t.status === 'FAILED').length;

    diagnostics.summary = {
      total: allTests.length,
      passed: passedTests,
      failed: failedTests,
      allPassed: failedTests === 0,
    };

    return NextResponse.json(diagnostics, { status: 200 });
  } catch (error: any) {
    diagnostics.error = {
      message: error.message,
      stack: error.stack,
    };
    return NextResponse.json(diagnostics, { status: 500 });
  }
}

