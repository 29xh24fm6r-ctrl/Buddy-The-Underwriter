import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { requireBorrowerOnDeal } from "@/lib/deals/participants";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/[dealId]/conditions
 *
 * Returns conditions for a deal. Role-aware:
 * - Borrowers: See their own deal conditions (enforced via deal_participants)
 * - Underwriters/Admins: See any deal conditions
 *
 * Returns: { ok: true, conditions: Condition[] }
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  try {
    const { role } = await requireRoleApi([
      "borrower",
      "underwriter",
      "bank_admin",
      "super_admin",
    ]);

    // API-level access control: borrowers can only see their own deals
    if (role === "borrower") {
      await requireBorrowerOnDeal(dealId); // Throws if not participant
    }

    // Fetch conditions
    const supabase = supabaseAdmin();
    const { data, error } = await (supabase as any)
      .from("conditions_to_close")
      .select("*")
      .eq("application_id", dealId)
      .order("severity", { ascending: true }) // REQUIRED first
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, conditions: data ?? [] });
  } catch (err: any) {
    rethrowNextErrors(err);

    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: err.code },
        { status: err.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const msg = String(err?.message ?? err);
    if (msg === "unauthorized") {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
    if (msg === "forbidden") {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
