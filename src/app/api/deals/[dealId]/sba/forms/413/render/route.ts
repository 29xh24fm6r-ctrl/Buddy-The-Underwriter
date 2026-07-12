import "server-only";

/**
 * SPEC S2 E — GET /api/deals/[dealId]/sba/forms/413/render?ownership_entity_id=...
 * One PFS per signer — the query param selects which owner's PDF to render.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildForm413Input } from "@/lib/sba/forms/form413/inputBuilder";
import { buildForm413 } from "@/lib/sba/forms/form413/build";
import { renderForm413Pdf } from "@/lib/sba/forms/form413/render";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await requireDealAccess(rawDealId);

    const ownershipEntityId = new URL(req.url).searchParams.get("ownership_entity_id");
    if (!ownershipEntityId) {
      return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const input = await buildForm413Input(dealId, sb);
    const buildResult = buildForm413(input);
    const rendered = await renderForm413Pdf({ supabase: sb, buildResult, ownershipEntityId });

    if (!rendered.ok) {
      return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
    }

    return new NextResponse(rendered.pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="form-413-${ownershipEntityId}.pdf"`,
      },
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/413/render]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
