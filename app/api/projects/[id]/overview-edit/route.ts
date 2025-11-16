import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

/**
 * 프로젝트 개요 정보를 가져오고 업데이트하는 API
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId } = await params;

    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select('id, project_name, project_type, description, tech_spec, deployment_url, repository_url, documentation_url, repo_name, repo_owner, repo_url')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (error || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ project });
  } catch (error) {
    console.error('Error in GET /api/projects/[id]/overview-edit:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId } = await params;
    const body = await request.json();

    // 업데이트할 필드만 추출
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (body.project_name !== undefined) updateData.project_name = body.project_name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.tech_spec !== undefined) updateData.tech_spec = body.tech_spec;
    if (body.deployment_url !== undefined) updateData.deployment_url = body.deployment_url;
    if (body.repository_url !== undefined) updateData.repository_url = body.repository_url;
    if (body.documentation_url !== undefined) updateData.documentation_url = body.documentation_url;

    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .update(updateData)
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating project:', error);
      return NextResponse.json(
        { error: '프로젝트 업데이트에 실패했습니다.', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ project });
  } catch (error) {
    console.error('Error in PATCH /api/projects/[id]/overview-edit:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

