import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertFormComplete } from "@/lib/sba/forms/assertFormComplete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/sba/completeness-gate?formCode=...&signerId=...
 *
 * Returns completeness gate result for a single form (and optionally a
 * specific signer). Used by the UI to show what's missing before a form
 * can be generated or signed.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const formCode = req.nextUrl.searchParams.get("formCode");
  if (!formCode) {
    return NextResponse.json({ ok: false, error: "formCode required" }, { status: 400 });
  }

  const signerId = req.nextUrl.searchParams.get("signerId") ?? undefined;
  const sb = supabaseAdmin() as unknown as { from: (t: string) => any };
  const result = await assertFormComplete(formCode, dealId, sb, signerId);
  return NextResponse.json({ ok: true, ...result });
}
