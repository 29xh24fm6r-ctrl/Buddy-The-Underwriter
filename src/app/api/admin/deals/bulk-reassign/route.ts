import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/deals/bulk-reassign
 *
 * Bulk reassign deals from one underwriter to another.
 * Super-admin only. Logs audit events for each reassignment.
 *
 * Body: {
 *   from_clerk_user_id: string,
 *   to_clerk_user_id: string,
 *   limit?: number (default 25, max 500),
 *   reason?: string
 * }
 *
 * Returns: {
 *   ok: true,
 *   from: string,
 *   to: string,
 *   requested: number,
 *   deals_found: number,
 *   moved: number
 * }
 */
export async function POST(req: NextRequest) {
  requireSuperAdmin();
  const supabase = supabaseAdmin();
  const { userId: actor } = await clerkAuth();

  const body = await req.json().catch(() => ({}));
  const from = String(body?.from_clerk_user_id ?? "");
  const to = String(body?.to_clerk_user_id ?? "");
  const limit = Math.max(1, Math.min(500, Number(body?.limit ?? 25)));
  const reason = String(body?.reason ?? "bulk_reassign");

  if (!from || !to) {
    return NextResponse.json(
      { ok: false, error: "from_clerk_user_id and to_clerk_user_id required" },
      { status: 400 },
    );
  }

  // Find deals currently assigned to `from`
  const { data: fromParts, error: e1 } = await (supabase as any)
    .from("deal_participants")
    .select("deal_id")
    .eq("role", "underwriter")
    .eq("is_active", true)
    .eq("clerk_user_id", from)
    .limit(limit);

  if (e1)
    return NextResponse.json({ ok: false, error: e1.message }, { status: 500 });

  const dealIds = Array.from(
    new Set((fromParts ?? []).map((r: any) => r.deal_id)),
  );

  let moved = 0;

  for (const dealId of dealIds) {
    // Deactivate old
    await (supabase as any)
      .from("deal_participants")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("deal_id", dealId)
      .eq("clerk_user_id", from)
      .eq("role", "underwriter");

    // Assign new
    await (supabase as any).from("deal_participants").upsert(
      {
        deal_id: dealId,
        clerk_user_id: to,
        role: "underwriter",
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,clerk_user_id,role" },
    );

    // Audit
    await (supabase as any).from("deal_participant_events").insert({
      deal_id: dealId,
      actor_clerk_user_id: actor ?? null,
      target_clerk_user_id: to,
      action: "BULK_REASSIGN",
      role: "underwriter",
      reason,
      metadata: { from, to },
    });

    moved++;
  }

  return NextResponse.json({
    ok: true,
    from,
    to,
    requested: limit,
    deals_found: dealIds.length,
    moved,
  });
}
