import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Debug endpoint to show current user info and auto-provision bank membership
 */
export async function GET() {
  try {
    const { userId } = await clerkAuth();
    
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated", userId: null },
        { status: 401 },
      );
    }

    const sb = supabaseAdmin();

    let ensuredBankId: string | null = null;
    let autoProvisioned = false;
    let tenantResolutionError: string | null = null;
    try {
      const before = await sb
        .from("bank_memberships")
        .select("bank_id")
        .eq("clerk_user_id", userId);
      const beforeCount = (before.data ?? []).length;

      ensuredBankId = await getCurrentBankId();

      const after = await sb
        .from("bank_memberships")
        .select("bank_id")
        .eq("clerk_user_id", userId);
      const afterCount = (after.data ?? []).length;
      autoProvisioned = afterCount > beforeCount;
    } catch (e: any) {
      const msg = String(e?.message || "unknown_error");
      // If auto-provision is disabled (e.g. prod), keep endpoint useful as an inspector.
      if (msg !== "no_memberships" && msg !== "multiple_memberships") {
        return NextResponse.json(
          { ok: false, error: msg, userId },
          { status: 500 },
        );
      }

      tenantResolutionError = msg;
    }

    // Check existing memberships
    const { data: memberships } = await sb
      .from("bank_memberships")
      .select("bank_id, role")
      .eq("clerk_user_id", userId);

    // Check profile
    const { data: profile } = await sb
      .from("profiles")
      .select("bank_id")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      userId,
      ensuredBankId,
      tenantResolutionError,
      memberships: memberships || [],
      profile: profile || null,
      autoProvisioned,
      message: autoProvisioned
        ? "Auto-provisioned bank membership (dev)."
        : "No changes.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "unknown_error" },
      { status: 500 },
    );
  }
}
