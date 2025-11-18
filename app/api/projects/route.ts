import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

export async function GET(request: NextRequest) {
  try {
    // 시스템 사용자 가져오기 (로그인 없이)
    const user = await getSystemUserFromSupabase();

    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다. 환경 변수를 확인해주세요.' },
        { status: 404 }
      );
    }

    const ownerId = user.id;

    // Fetch projects for this user using direct SQL query to bypass RLS on views
    const { data: projects, error } = await supabaseAdmin.rpc('get_user_projects', {
      p_owner_id: ownerId,
    });

    if (error) {
      console.error('Error fetching projects:', error);
      // Fallback to direct table access if RPC fails
      const { data: projectsDirect, error: directError } = await supabaseAdmin
        .from('projects')
        .select(`
          id, 
          repo_name, 
          repo_owner, 
          repo_url, 
          project_name, 
          project_type,
          description, 
          created_at, 
          updated_at,
          project_analysis (
            project_overview
          )
        `)
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });

      if (directError) {
        console.error('Error fetching projects (direct):', directError);
        return NextResponse.json(
          { error: 'Failed to fetch projects', details: directError.message },
          { status: 500 }
        );
      }

      // project_overview와 대표 이미지를 각 프로젝트에 추가
      const projectsWithOverview = await Promise.all(
        (projectsDirect || []).map(async (project: any) => {
          // 대표 이미지 조회
          const { data: primaryScreenshot } = await supabaseAdmin
            .from('project_screenshots')
            .select('id, storage_path, file_name')
            .eq('project_id', project.id)
            .eq('is_primary', true)
            .is('deleted_at', null)
            .single();

          // 최신 댓글 1개 조회
          const { data: latestComment } = await supabaseAdmin
            .from('project_comments')
            .select('id, author_name, content, created_at')
            .eq('project_id', project.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          return {
            ...project,
            project_name: project.project_name || project.repo_name || null,
            project_type: project.project_type || 'github',
            project_overview: project.project_analysis?.[0]?.project_overview || null,
            primary_screenshot: primaryScreenshot || null,
            latest_comment: latestComment || null,
          };
        })
      );

      return NextResponse.json({ projects: projectsWithOverview });
    }

    // RPC 결과에도 project_overview, description, project_name, project_type 추가 (RPC가 포함하지 않을 수 있음)
    // 각 프로젝트별로 누락된 필드 조회
    const projectsWithOverview = await Promise.all(
      (projects || []).map(async (project: any) => {
        // project_name, description, project_type이 없으면 조회
        let projectName = project.project_name;
        let description = project.description;
        let projectType = project.project_type;
        
        if (!projectName || !description || !projectType) {
          const { data: projectData } = await supabaseAdmin
            .from('projects')
            .select('project_name, description, project_type')
            .eq('id', project.id)
            .single();
          projectName = projectName || projectData?.project_name || null;
          description = description || projectData?.description || null;
          projectType = projectType || projectData?.project_type || 'github';
        }
        
        // project_overview 조회
        let projectOverview = project.project_overview;
        if (!projectOverview) {
          const { data: analysis } = await supabaseAdmin
            .from('project_analysis')
            .select('project_overview')
            .eq('project_id', project.id)
            .single();
          projectOverview = analysis?.project_overview || null;
        }

        // 대표 이미지 조회
        const { data: primaryScreenshot } = await supabaseAdmin
          .from('project_screenshots')
          .select('id, storage_path, file_name')
          .eq('project_id', project.id)
          .eq('is_primary', true)
          .is('deleted_at', null)
          .single();

        // 최신 댓글 1개 조회
        const { data: latestComment } = await supabaseAdmin
          .from('project_comments')
          .select('id, author_name, content, created_at')
          .eq('project_id', project.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        
        return {
          ...project,
          project_name: projectName,
          description: description,
          project_type: projectType,
          project_overview: projectOverview,
          primary_screenshot: primaryScreenshot || null,
          latest_comment: latestComment || null,
        };
      })
    );

    return NextResponse.json({ projects: projectsWithOverview });
  } catch (error) {
    console.error('Error in GET /api/projects:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
