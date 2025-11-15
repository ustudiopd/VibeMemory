import { NextRequest, NextResponse } from 'next/server';
import { getGitHubRepositories } from '@/lib/github';
import { getSystemUser } from '@/lib/system-user';

export async function GET(request: NextRequest) {
  try {
    // 시스템 사용자의 GitHub Access Token 사용
    const systemUser = getSystemUser();
    if (!systemUser || !systemUser.githubAccessToken) {
      return NextResponse.json(
        { error: '시스템 GitHub Access Token이 설정되지 않았습니다.' },
        { status: 401 }
      );
    }

    const accessToken = systemUser.githubAccessToken;

    // Fetch repositories from GitHub
    const repositories = await getGitHubRepositories(accessToken);

    // Transform to match frontend interface
    const formattedRepos = repositories.map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      owner: {
        login: repo.owner.login,
      },
      description: repo.description || '',
      updated_at: repo.updated_at,
      private: repo.private,
      default_branch: repo.default_branch || 'main',
    }));

    return NextResponse.json({ repositories: formattedRepos });
  } catch (error) {
    console.error('Error fetching repositories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch repositories', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

