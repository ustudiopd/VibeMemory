import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase environment variables are missing!');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

if (!supabaseServiceRoleKey) {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY is missing. Admin operations may fail.');
}

// Client-side Supabase client (for use in components)
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
);

// Server-side Supabase client (for use in API routes with service role)
export const supabaseAdmin = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseServiceRoleKey || 'placeholder-service-role-key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

