import { supabaseAdmin } from './supabase';

/**
 * Store GitHub access token for a user
 * In production, encrypt this token before storing
 */
export async function storeGitHubToken(userId: string, accessToken: string) {
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const userData = user.user;
  await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...(userData?.user_metadata || {}),
      github_access_token: accessToken,
    },
  });
}

/**
 * Get GitHub access token for a user
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
  return user?.user?.user_metadata?.github_access_token || null;
}

