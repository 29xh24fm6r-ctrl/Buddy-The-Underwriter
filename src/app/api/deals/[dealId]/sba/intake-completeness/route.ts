import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkIntakeCompleteness } from "@/lib/sba/forms/intakeCompleteness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/sba/intake-completeness
 *
 * Returns the full intake completeness status for all SBA forms
 * applicable to this deal — what's answered, what's missing, what
 * needs PII vault input, what needs character-question confirmation.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const sb = supabaseAdmin();
  const result = await checkIntakeCompleteness({ dealId, sb });
  return NextResponse.json({ ok: true, ...result });
}
