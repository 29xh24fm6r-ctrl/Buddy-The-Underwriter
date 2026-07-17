import { supabaseAdmin } from "@/lib/supabase/admin";
import crypto from "node:crypto";

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
  // This token is the sole credential guarding a borrower's full loan
  // application (PII, financials) at /borrower/[token]/*. Math.random() is
  // not cryptographically secure and its output is predictable/brute-forceable
  // — use a CSPRNG, matching src/lib/borrower/portalToken.ts.
  return crypto.randomBytes(32).toString("base64url");
}
