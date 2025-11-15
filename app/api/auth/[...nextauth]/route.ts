import NextAuth, { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import { supabaseAdmin } from '@/lib/supabase';

// Validate required environment variables
if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
  console.warn('⚠️  GitHub OAuth credentials not configured. Authentication will not work.');
}

if (!process.env.NEXTAUTH_SECRET) {
  console.warn('⚠️  NEXTAUTH_SECRET not configured. Using a default secret (not secure for production).');
}

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || 'dummy-client-id',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || 'dummy-client-secret',
      authorization: {
        params: {
          scope: 'read:user user:email repo',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'github' && account.access_token) {
        try {
          // Check if user exists in Supabase Auth
          const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
          const githubId = (profile as any)?.id || (profile as any)?.node_id;
          const existingUser = existingUsers?.users.find(
            (u) => u.email === user.email || u.user_metadata?.github_id === githubId
          );

          if (!existingUser) {
            // Create new user in Supabase Auth
            const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
              email: user.email!,
              email_confirm: true,
              user_metadata: {
                github_id: githubId,
                github_username: (profile as any)?.login,
                name: user.name,
                avatar_url: user.image,
              },
            });

            if (error) {
              console.error('Error creating user:', error);
              return false;
            }
          } else {
            // Update existing user metadata
            await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
              user_metadata: {
                ...existingUser.user_metadata,
                github_id: githubId,
                github_username: (profile as any)?.login,
                name: user.name,
                avatar_url: user.image,
              },
            });
          }

          return true;
        } catch (error) {
          console.error('Error in signIn callback:', error);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, account, profile, user }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
        
        // Store GitHub token in Supabase user metadata
        if (user?.email) {
          try {
            const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
            const supabaseUser = userData?.users.find((u) => u.email === user.email);
            if (supabaseUser) {
              await supabaseAdmin.auth.admin.updateUserById(supabaseUser.id, {
                user_metadata: {
                  ...supabaseUser.user_metadata,
                  github_access_token: account.access_token,
                },
              });
            }
          } catch (error) {
            console.error('Error storing GitHub token:', error);
          }
        }
      }
      if (profile) {
        token.githubId = (profile as any)?.id || (profile as any)?.node_id;
        token.githubUsername = (profile as any)?.login;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.accessToken) {
        session.accessToken = token.accessToken as string;
      }
      if (token.githubId) {
        session.user.githubId = token.githubId as string;
        session.user.githubUsername = token.githubUsername as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  secret: process.env.NEXTAUTH_SECRET || 'default-secret-change-in-production',
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

