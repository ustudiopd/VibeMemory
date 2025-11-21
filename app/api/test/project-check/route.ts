import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * GET /api/test/project-check?projectId=<uuid>
 * 
 * 프로젝트 조회 문제 진단을 위한 테스트 엔드포인트
 * 
 * 다양한 방법으로 같은 프로젝트를 조회하여 차이점을 확인합니다:
 * 1. Public 뷰로 조회 (owner 필터 없음)
 * 2. Vibememory 테이블로 조회 (owner 필터 없음)
 * 3. Vibememory 테이블로 조회 (owner 필터 적용)
 * 4. Public 뷰로 조회 (owner 필터 적용)
 * 5. get_user_projects RPC 결과에서 찾기
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { 
          error: 'projectId is required',
          usage: 'GET /api/test/project-check?projectId=<uuid>'
        },
        { status: 400 }
      );
    }

    // 시스템 사용자 정보 가져오기
    const systemUser = await getSystemUserFromSupabase();
    if (!systemUser) {
      return NextResponse.json(
        { 
          error: '시스템 사용자를 찾을 수 없습니다.',
          details: 'SYSTEM_GITHUB_USERNAME 또는 SYSTEM_USER_EMAIL 환경 변수를 확인해주세요.'
        },
        { status: 401 }
      );
    }

    const results: any = {
      timestamp: new Date().toISOString(),
      projectId,
      systemUser: {
        id: systemUser.id,
        email: systemUser.email,
        githubUsername: systemUser.user_metadata?.github_username,
      },
      tests: {},
    };

    // 테스트 1: Public 뷰로 조회 (owner 필터 없음)
    console.log('[TEST] 1. Public view without owner filter');
    const { data: publicView, error: publicViewError } = await supabaseAdmin
      .schema('public')
      .from('projects')
      .select('id, owner_id, project_name, repo_owner, repo_name, created_at')
      .eq('id', projectId)
      .maybeSingle();

    results.tests.publicView = {
      success: !publicViewError && !!publicView,
      data: publicView,
      error: publicViewError ? {
        code: publicViewError.code,
        message: publicViewError.message,
        details: publicViewError.details,
      } : null,
    };

    // 테스트 2: Vibememory 테이블로 조회 (owner 필터 없음)
    console.log('[TEST] 2. Vibememory table without owner filter');
    const { data: vibememoryTable, error: vibememoryTableError } = await supabaseAdmin
      .schema('vibememory')
      .from('projects')
      .select('id, owner_id, project_name, repo_owner, repo_name, created_at')
      .eq('id', projectId)
      .maybeSingle();

    results.tests.vibememoryTable = {
      success: !vibememoryTableError && !!vibememoryTable,
      data: vibememoryTable,
      error: vibememoryTableError ? {
        code: vibememoryTableError.code,
        message: vibememoryTableError.message,
        details: vibememoryTableError.details,
      } : null,
    };

    // 테스트 3: Vibememory 테이블로 조회 (owner 필터 적용)
    console.log('[TEST] 3. Vibememory table with owner filter');
    const { data: vibememoryWithOwner, error: vibememoryWithOwnerError } = await supabaseAdmin
      .schema('vibememory')
      .from('projects')
      .select('id, owner_id, project_name, repo_owner, repo_name, created_at')
      .eq('id', projectId)
      .eq('owner_id', systemUser.id)
      .maybeSingle();

    results.tests.vibememoryWithOwner = {
      success: !vibememoryWithOwnerError && !!vibememoryWithOwner,
      data: vibememoryWithOwner,
      error: vibememoryWithOwnerError ? {
        code: vibememoryWithOwnerError.code,
        message: vibememoryWithOwnerError.message,
        details: vibememoryWithOwnerError.details,
      } : null,
    };

    // 테스트 4: Public 뷰로 조회 (owner 필터 적용)
    console.log('[TEST] 4. Public view with owner filter');
    const { data: publicWithOwner, error: publicWithOwnerError } = await supabaseAdmin
      .schema('public')
      .from('projects')
      .select('id, owner_id, project_name, repo_owner, repo_name, created_at')
      .eq('id', projectId)
      .eq('owner_id', systemUser.id)
      .maybeSingle();

    results.tests.publicWithOwner = {
      success: !publicWithOwnerError && !!publicWithOwner,
      data: publicWithOwner,
      error: publicWithOwnerError ? {
        code: publicWithOwnerError.code,
        message: publicWithOwnerError.message,
        details: publicWithOwnerError.details,
      } : null,
    };

    // 테스트 5: get_user_projects RPC 결과에서 찾기
    console.log('[TEST] 5. get_user_projects RPC');
    const { data: rpcProjects, error: rpcError } = await supabaseAdmin
      .schema('public')
      .rpc('get_user_projects', {
        p_owner_id: systemUser.id,
      });

    const rpcProject = rpcProjects?.find((p: any) => p.id === projectId) || null;

    results.tests.rpcProjects = {
      success: !rpcError,
      foundInList: !!rpcProject,
      totalProjects: rpcProjects?.length || 0,
      data: rpcProject,
      error: rpcError ? {
        code: rpcError.code,
        message: rpcError.message,
        details: rpcError.details,
      } : null,
    };

    // 테스트 6: Owner ID 비교
    console.log('[TEST] 6. Owner ID comparison');
    const ownerIds = {
      publicView: publicView?.owner_id,
      vibememoryTable: vibememoryTable?.owner_id,
      systemUser: systemUser.id,
      match: {
        publicView: publicView?.owner_id === systemUser.id,
        vibememoryTable: vibememoryTable?.owner_id === systemUser.id,
      },
    };

    results.tests.ownerIdComparison = ownerIds;

    // 요약
    results.summary = {
      projectExists: {
        inPublicView: !!publicView,
        inVibememoryTable: !!vibememoryTable,
        inRpcList: !!rpcProject,
      },
      accessibleWithOwnerFilter: {
        publicView: !!publicWithOwner,
        vibememoryTable: !!vibememoryWithOwner,
      },
      ownerIdMatches: {
        publicView: publicView?.owner_id === systemUser.id,
        vibememoryTable: vibememoryTable?.owner_id === systemUser.id,
      },
      recommendation: getRecommendation(results),
    };

    return NextResponse.json(results, { status: 200 });
  } catch (error) {
    console.error('[TEST] Error in project-check:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * 테스트 결과를 바탕으로 권장 사항 생성
 */
function getRecommendation(results: any): string {
  const { tests } = results;

  // 케이스 1: Public 뷰는 되는데 vibememory 테이블은 안 됨
  if (tests.publicView.success && !tests.vibememoryTable.success) {
    return 'Public 뷰로 전환 권장: Public 뷰는 작동하지만 vibememory 테이블 직접 접근이 실패합니다.';
  }

  // 케이스 2: Owner 필터를 빼면 되는데, 걸면 안 됨
  if (
    (tests.publicView.success || tests.vibememoryTable.success) &&
    !tests.publicWithOwner.success &&
    !tests.vibememoryWithOwner.success
  ) {
    return 'Owner ID 불일치 의심: 필터 없이는 조회되지만 owner 필터 적용 시 실패합니다. owner_id와 시스템 사용자 ID를 확인해주세요.';
  }

  // 케이스 3: RPC는 되는데 직접 쿼리는 안 됨
  if (tests.rpcProjects.foundInList && !tests.vibememoryWithOwner.success) {
    return 'RPC 내부 로직 확인 필요: get_user_projects RPC에서는 찾을 수 있지만 직접 쿼리로는 실패합니다. RPC 내부 로직을 확인해주세요.';
  }

  // 케이스 4: 모든 방법이 실패
  if (
    !tests.publicView.success &&
    !tests.vibememoryTable.success &&
    !tests.rpcProjects.foundInList
  ) {
    return '프로젝트가 존재하지 않음: 모든 방법으로 조회 실패. 프로젝트 ID가 올바른지 확인해주세요.';
  }

  // 케이스 5: 모든 방법이 성공
  if (
    tests.publicView.success &&
    tests.vibememoryTable.success &&
    tests.vibememoryWithOwner.success &&
    tests.publicWithOwner.success
  ) {
    return '모든 테스트 통과: 프로젝트 조회가 정상적으로 작동합니다.';
  }

  return '부분적 성공: 일부 방법으로는 조회 가능하지만 일관성이 없습니다. 상세 결과를 확인해주세요.';
}

