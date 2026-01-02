import "server-only";
import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/borrower/active-deal
 *
 * Returns the most recent deal (application) for the signed-in borrower.
 * Uses deal_participants table for deterministic role-based ownership.
 *
 * Returns: {ok: true, dealId: string} | {ok: false, error: string}
 */
export async function GET() {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const supabase = supabaseAdmin();

  // Deterministic: borrower's most recently-updated active participant row
  const { data, error } = await (supabase as any)
    .from("deal_participants")
    .select("deal_id, updated_at")
    .eq("clerk_user_id", userId)
    .eq("role", "borrower")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  if (!data?.deal_id) {
    return NextResponse.json(
      { ok: false, error: "no_active_deal" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, dealId: (data as any).deal_id });
}
