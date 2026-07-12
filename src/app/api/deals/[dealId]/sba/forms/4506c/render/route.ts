import "server-only";

/**
 * SPEC S4 D-1 — GET /api/deals/[dealId]/sba/forms/4506c/render?ownership_entity_id=...
 * One 4506-C is rendered per signer (spec H-1: "always per signer") — the
 * query param selects which signer's copy to render.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildForm4506cInput } from "@/lib/sba/forms/form4506c/inputBuilder";
import { buildForm4506c } from "@/lib/sba/forms/form4506c/build";
import { renderForm4506cPdf } from "@/lib/sba/forms/form4506c/render";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId } = await requireDealAccess(rawDealId);

    const ownershipEntityId = new URL(req.url).searchParams.get("ownership_entity_id");
    if (!ownershipEntityId) {
      return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const input = await buildForm4506cInput(dealId, bankId, sb);
    const buildResult = buildForm4506c(input);
    const rendered = await renderForm4506cPdf({ supabase: sb, buildResult, ownershipEntityId });

    if (!rendered.ok) {
      return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
    }

    return new NextResponse(rendered.pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="form-4506c-${dealId}-${ownershipEntityId}.pdf"`,
      },
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/4506c/render]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
