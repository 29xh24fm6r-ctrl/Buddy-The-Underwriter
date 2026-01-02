// src/lib/supabase/serverAuthed.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";

type AuthedSupabase = {
  supabase: SupabaseClient;
  userId: string;
};

/**
 * Creates a Supabase client that runs under the caller's identity (RLS enforced)
 * using a Clerk JWT (template: "supabase").
 *
 * Requirements:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY
 * - Clerk JWT template named "supabase" configured to mint a Supabase-compatible JWT
 */
export async function getAuthedSupabase(): Promise<AuthedSupabase> {
  const { userId, getToken } = await clerkAuth();

  if (!userId) {
    throw new Error("unauthorized: missing clerk userId");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("server_misconfig: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  const token = await getToken({ template: "supabase" });
  if (!token) {
    throw new Error("unauthorized: missing supabase jwt (Clerk token template 'supabase')");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  return { supabase, userId };
}
