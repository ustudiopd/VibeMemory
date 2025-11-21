import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { Octokit } from '@octokit/rest';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 시스템 사용자 확인
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId } = await params;

    // 프로젝트 소유권 확인 (public 뷰 사용)
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, owner_id, repo_owner, repo_name, webhook_id')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없거나 삭제 권한이 없습니다.' },
        { status: 404 }
      );
    }

    // GitHub Webhook 삭제 (있는 경우)
    if (project.webhook_id) {
      try {
        const { getSystemUser } = await import('@/lib/system-user');
        const systemUser = getSystemUser();
        
        if (systemUser?.githubAccessToken) {
          const octokit = new Octokit({
            auth: systemUser.githubAccessToken,
          });

          await octokit.repos.deleteWebhook({
            owner: project.repo_owner,
            repo: project.repo_name,
            hook_id: project.webhook_id,
          });
        }
      } catch (error) {
        console.error('Error deleting webhook:', error);
        // Webhook 삭제 실패해도 프로젝트 삭제는 계속 진행
      }
    }

    // 관련 job_locks 삭제 (임포트/재스캔 잠금 해제)
    const jobNames = [
      `import:${project.repo_owner}/${project.repo_name}`,
      `rescan:${project.repo_owner}/${project.repo_name}`,
      `webhook:${project.repo_owner}/${project.repo_name}`,
    ];

    for (const jobName of jobNames) {
      try {
        await supabaseAdmin
          .from('job_locks')
          .delete()
          .eq('job_name', jobName);
      } catch (error) {
        console.error(`Error deleting job lock ${jobName}:`, error);
        // 잠금 삭제 실패해도 프로젝트 삭제는 계속 진행
      }
    }

    // 프로젝트 삭제 (CASCADE로 관련 데이터 자동 삭제, public 뷰 사용)
    const { error: deleteError } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('owner_id', user.id);

    if (deleteError) {
      console.error('Error deleting project:', deleteError);
      return NextResponse.json(
        { error: '프로젝트 삭제에 실패했습니다.', details: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, message: '프로젝트가 삭제되었습니다.' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in DELETE /api/projects/[id]:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

