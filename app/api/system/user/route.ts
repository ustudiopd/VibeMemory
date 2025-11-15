import { NextRequest, NextResponse } from 'next/server';
import { getSystemUser, getSystemUserFromSupabase } from '@/lib/system-user';

export async function GET(request: NextRequest) {
  try {
    const systemUser = getSystemUser();
    const supabaseUser = await getSystemUserFromSupabase();

    if (!systemUser || !supabaseUser) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      user: {
        name: systemUser.name || supabaseUser.user_metadata?.name || systemUser.githubUsername,
        email: systemUser.email || supabaseUser.email,
        githubUsername: systemUser.githubUsername,
      },
    });
  } catch (error) {
    console.error('Error fetching system user:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

