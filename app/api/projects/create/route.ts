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

    // 프로젝트 이름 길이 제한 (1-100자)
    const trimmedProjectName = project_name.trim();
    if (trimmedProjectName.length === 0) {
      return NextResponse.json(
        { error: '프로젝트 이름은 공백만으로 구성될 수 없습니다.' },
        { status: 400 }
      );
    }
    if (trimmedProjectName.length > 100) {
      return NextResponse.json(
        { error: '프로젝트 이름은 100자 이하여야 합니다.' },
        { status: 400 }
      );
    }

    // 금지 문자 검증 (SQL 인젝션 방지, 특수문자 제한)
    const forbiddenChars = /[<>'"\\]/;
    if (forbiddenChars.test(trimmedProjectName)) {
      return NextResponse.json(
        { error: '프로젝트 이름에 사용할 수 없는 문자가 포함되어 있습니다. (<, >, \', ", \\, /)' },
        { status: 400 }
      );
    }

    if (project_type !== 'idea' && project_type !== 'github') {
      return NextResponse.json(
        { error: 'project_type은 "idea" 또는 "github"여야 합니다.' },
        { status: 400 }
      );
    }

    // 텍스트 필드 길이 제한 (20KB = 20,000자)
    const maxTextLength = 20000;
    if (description && description.length > maxTextLength) {
      return NextResponse.json(
        { error: '프로젝트 설명은 20,000자 이하여야 합니다.' },
        { status: 400 }
      );
    }
    if (tech_spec && tech_spec.length > maxTextLength) {
      return NextResponse.json(
        { error: '기술 스펙은 20,000자 이하여야 합니다.' },
        { status: 400 }
      );
    }

    // URL 형식 검증
    const urlPattern = /^https?:\/\/.+/;
    if (deployment_url && !urlPattern.test(deployment_url)) {
      return NextResponse.json(
        { error: '배포 URL은 유효한 HTTP/HTTPS URL이어야 합니다.' },
        { status: 400 }
      );
    }
    if (documentation_url && !urlPattern.test(documentation_url)) {
      return NextResponse.json(
        { error: '문서 URL은 유효한 HTTP/HTTPS URL이어야 합니다.' },
        { status: 400 }
      );
    }
    if (repository_url && !urlPattern.test(repository_url)) {
      return NextResponse.json(
        { error: '저장소 URL은 유효한 HTTP/HTTPS URL이어야 합니다.' },
        { status: 400 }
      );
    }

    // 아이디어 프로젝트 생성
    if (project_type === 'idea') {
      console.log('[CREATE PROJECT] Creating idea project...');
      const insertData = {
        owner_id: ownerId,
        project_type: 'idea',
        project_name: trimmedProjectName, // 검증된 이름 사용
        description: description?.trim() || null,
        tech_spec: tech_spec?.trim() || null,
        deployment_url: deployment_url?.trim() || null,
        documentation_url: documentation_url?.trim() || null,
        repository_url: repository_url?.trim() || null,
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
        
        // 중복 프로젝트 에러 처리 (부분 유니크 인덱스 위반)
        if (insertError.code === '23505') { // unique_violation
          const errorMessage = insertError.message?.includes('uq_projects_idea')
            ? '이미 같은 이름의 프로젝트가 존재합니다. 다른 이름을 사용해주세요.'
            : '프로젝트 생성에 실패했습니다. 중복된 프로젝트가 있을 수 있습니다.';
          
          return NextResponse.json(
            { 
              error: errorMessage,
              details: insertError.message,
              code: insertError.code,
            },
            { status: 409 } // Conflict
          );
        }
        
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

