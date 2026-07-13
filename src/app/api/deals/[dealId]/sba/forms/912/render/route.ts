import "server-only";

/** SPEC S4 G-2 — GET /api/deals/[dealId]/sba/forms/912/render?ownership_entity_id=... */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { buildForm912Input } from "@/lib/sba/forms/form912/inputBuilder";
import { buildForm912 } from "@/lib/sba/forms/form912/build";
import { renderForm912Pdf } from "@/lib/sba/forms/form912/render";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await assertDealAccess(rawDealId);

    const ownershipEntityId = new URL(req.url).searchParams.get("ownership_entity_id");
    if (!ownershipEntityId) {
      return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const input = await buildForm912Input(dealId, sb);
    const buildResult = buildForm912(input);
    const rendered = await renderForm912Pdf({ supabase: sb, buildResult, ownershipEntityId });

    if (!rendered.ok) {
      return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
    }

    return new NextResponse(rendered.pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="form-912-${dealId}-${ownershipEntityId}.pdf"`,
      },
    });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/sba/forms/912/render]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
