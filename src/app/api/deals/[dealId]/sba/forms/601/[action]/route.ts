import "server-only";

/**
 * SPEC S7 (ARC-00 Phase 5) — GET /api/deals/[dealId]/sba/forms/601/[action]
 * action ∈ {"build", "render"}. Consolidated route, same pattern as
 * form1244's/form148's.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildForm601WithSignature } from "@/lib/sba/forms/form601/buildWithSignature";
import { buildForm601Input } from "@/lib/sba/forms/form601/inputBuilder";
import { renderForm601Pdf } from "@/lib/sba/forms/form601/render";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; action: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, action } = await ctx.params;
    const { dealId, bankId } = await requireDealAccess(rawDealId);
    const sb = supabaseAdmin();

    if (action === "build") {
      const result = await buildForm601WithSignature(dealId, bankId, sb);
      return NextResponse.json({ ok: true, dealId, ...result });
    }

    if (action === "render") {
      const buildResult = await buildForm601Input(dealId, bankId, sb);
      const rendered = await renderForm601Pdf({ supabase: sb, buildResult });

      if (!rendered.ok) {
        return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
      }

      return new NextResponse(rendered.pdfBytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="form-601-${dealId}.pdf"`,
        },
      });
    }

    return NextResponse.json({ ok: false, error: `unsupported_action: ${action}` }, { status: 400 });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/601/[action]]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
