import "server-only";

/**
 * PATCH /api/deals/[dealId]/covenants/override
 *
 * Banker override — append-only with required justification.
 */

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const body = await req.json();

  if (!body.packageId || !body.covenantId || !body.overrideType || !body.justification) {
    return NextResponse.json({
      ok: false,
      error: "packageId, covenantId, overrideType, and justification required",
    }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { error } = await sb.from("buddy_covenant_overrides").insert({
    package_id: body.packageId,
    covenant_id: body.covenantId,
    override_type: body.overrideType,
    original_value: body.originalValue ?? null,
    new_value: body.newValue ?? null,
    justification: body.justification,
    overridden_by: userId,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
