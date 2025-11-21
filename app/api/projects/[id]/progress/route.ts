import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';

export async function GET(
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

    // Verify project ownership (시스템 사용자의 프로젝트인지 확인, public 뷰 사용)
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, owner_id')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get progress using RPC function (public 래퍼 함수)
    const { data: progress, error: progressError } = await supabaseAdmin
      .schema('public')
      .rpc('get_project_progress', {
        p_project_id: projectId,
      });

    if (progressError) {
      console.error('Error getting progress:', progressError);
      return NextResponse.json(
        { error: 'Failed to get progress', details: progressError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(progress, { status: 200 });
  } catch (error) {
    console.error('Error in progress API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
