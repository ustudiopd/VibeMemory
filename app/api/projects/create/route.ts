import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * POST /api/projects/create
 * 아이디어 프로젝트 생성 API
 * 해결책.md 1.2장 참조
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[CREATE PROJECT] Starting project creation...');
    
    // 시스템 사용자 가져오기
    const user = await getSystemUserFromSupabase();

    if (!user) {
      console.error('[CREATE PROJECT] System user not found');
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다. 환경 변수를 확인해주세요.' },
        { status: 404 }
      );
    }

    console.log('[CREATE PROJECT] System user found:', user.id);
    const ownerId = user.id;
    const body = await request.json();
    console.log('[CREATE PROJECT] Request body:', { ...body, project_name: body.project_name });
    const {
      project_type = 'idea',
      project_name,
      description,
      tech_spec,
      deployment_url,
      documentation_url,
      repository_url,
    } = body;

    // 유효성 검사
    if (!project_name) {
      return NextResponse.json(
        { error: '프로젝트 이름은 필수입니다.' },
        { status: 400 }
      );
    }

    if (project_type !== 'idea' && project_type !== 'github') {
      return NextResponse.json(
        { error: 'project_type은 "idea" 또는 "github"여야 합니다.' },
        { status: 400 }
      );
    }

    // 아이디어 프로젝트 생성
    if (project_type === 'idea') {
      console.log('[CREATE PROJECT] Creating idea project...');
      const insertData = {
        owner_id: ownerId,
        project_type: 'idea',
        project_name,
        description: description || null,
        tech_spec: tech_spec || null,
        deployment_url: deployment_url || null,
        documentation_url: documentation_url || null,
        repository_url: repository_url || null,
        // GitHub 관련 필드는 NULL
        repo_owner: null,
        repo_name: null,
        repo_url: null,
        webhook_id: null,
      };
      console.log('[CREATE PROJECT] Insert data:', { ...insertData, project_name: insertData.project_name });
      
      const { data: project, error: insertError } = await supabaseAdmin
        .from('projects')
        .insert(insertData)
        .select()
        .single();

      if (insertError) {
        console.error('[CREATE PROJECT] Error creating idea project:', insertError);
        console.error('[CREATE PROJECT] Error code:', insertError.code);
        console.error('[CREATE PROJECT] Error details:', insertError.details);
        console.error('[CREATE PROJECT] Error hint:', insertError.hint);
        return NextResponse.json(
          { 
            error: '프로젝트 생성에 실패했습니다.', 
            details: insertError.message,
            code: insertError.code,
            hint: insertError.hint,
          },
          { status: 500 }
        );
      }

      console.log('[CREATE PROJECT] Project created successfully:', project.id);

      // 아이디어 프로젝트는 ingestion_runs, scan_progress 생성하지 않음
      // project_analysis도 생성하지 않음 (선택적)

      return NextResponse.json({
        success: true,
        project_id: project.id,
        project,
        message: '프로젝트가 생성되었습니다.',
      });
    }

    // GitHub 프로젝트는 /api/projects/import를 사용해야 함
    return NextResponse.json(
      { error: 'GitHub 프로젝트는 /api/projects/import를 사용해주세요.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[CREATE PROJECT] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

