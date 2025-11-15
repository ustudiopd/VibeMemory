/**
 * 시스템에 등록된 기본 사용자 정보
 * 환경 변수에서 가져오거나 기본값 사용
 */

export interface SystemUser {
  githubUsername: string;
  githubAccessToken: string;
  email?: string;
  name?: string;
}

/**
 * 시스템 사용자 정보 가져오기
 * 환경 변수에서 설정된 사용자 정보를 반환
 */
export function getSystemUser(): SystemUser | null {
  const githubUsername = process.env.SYSTEM_GITHUB_USERNAME || 'ustudiopd';
  const githubAccessToken = process.env.SYSTEM_GITHUB_ACCESS_TOKEN;

  if (!githubAccessToken) {
    console.warn('⚠️  SYSTEM_GITHUB_ACCESS_TOKEN이 설정되지 않았습니다.');
    return null;
  }

  return {
    githubUsername,
    githubAccessToken,
    email: process.env.SYSTEM_USER_EMAIL,
    name: process.env.SYSTEM_USER_NAME || githubUsername,
  };
}

/**
 * Supabase에서 시스템 사용자 찾기
 */
export async function getSystemUserFromSupabase() {
  const systemUser = getSystemUser();
  if (!systemUser) {
    return null;
  }

  const { supabaseAdmin } = await import('@/lib/supabase');
  
  // Supabase Auth에서 시스템 사용자 찾기
  const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
  const user = userData?.users.find(
    (u) =>
      u.user_metadata?.github_username === systemUser.githubUsername ||
      u.email === systemUser.email
  );

  return user || null;
}

