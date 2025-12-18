import { supabaseAdmin } from "@/lib/supabase/admin";

export async function requireBorrowerToken(token: string) {
  const sb = supabaseAdmin();

  const { data: application, error } = await sb
    .from("borrower_applications")
    .select("*")
    .eq("token", token)
    .single();

  if (error || !application) {
    throw new Error("Invalid or expired token");
  }

  return { application: application as any };
}

export function generateToken(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
