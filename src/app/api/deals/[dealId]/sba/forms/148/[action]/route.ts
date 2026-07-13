import "server-only";

/**
 * SPEC S7 (ARC-00 Phase 5) — GET /api/deals/[dealId]/sba/forms/148/[action]?ownership_entity_id=...
 * action ∈ {"build", "render"}. Consolidated route, same pattern as
 * form1244's — see that route's docstring for the route-budget rationale.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { buildForm148WithSignature } from "@/lib/sba/forms/form148/buildWithSignature";
import { buildForm148Input } from "@/lib/sba/forms/form148/inputBuilder";
import { buildForm148 } from "@/lib/sba/forms/form148/build";
import { renderForm148Pdf } from "@/lib/sba/forms/form148/render";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; action: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, action } = await ctx.params;
    const { dealId, bankId } = await assertDealAccess(rawDealId);
    const sb = supabaseAdmin();

    if (action === "build") {
      const result = await buildForm148WithSignature(dealId, bankId, sb);
      return NextResponse.json({ ok: true, dealId, ...result });
    }

    if (action === "render") {
      const ownershipEntityId = new URL(req.url).searchParams.get("ownership_entity_id");
      if (!ownershipEntityId) {
        return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
      }
      const input = await buildForm148Input(dealId, bankId, sb);
      const buildResult = buildForm148(input);
      const rendered = await renderForm148Pdf({ supabase: sb, buildResult, ownershipEntityId });

      if (!rendered.ok) {
        return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
      }

      return new NextResponse(rendered.pdfBytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="form-148-${dealId}-${ownershipEntityId}.pdf"`,
        },
      });
    }

    return NextResponse.json({ ok: false, error: `unsupported_action: ${action}` }, { status: 400 });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/sba/forms/148/[action]]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
