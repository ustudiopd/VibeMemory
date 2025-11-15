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
        .select('id, repo_name, repo_owner, repo_url, project_name, description, created_at, updated_at')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });

      if (directError) {
        console.error('Error fetching projects (direct):', directError);
        return NextResponse.json(
          { error: 'Failed to fetch projects', details: directError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ projects: projectsDirect || [] });
    }

    return NextResponse.json({ projects: projects || [] });
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
