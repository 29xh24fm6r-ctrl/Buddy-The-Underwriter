import "server-only";

/** SPEC S4 G-3 — GET /api/deals/[dealId]/sba/forms/155/render */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildForm155Input } from "@/lib/sba/forms/form155/inputBuilder";
import { renderForm155Pdf } from "@/lib/sba/forms/form155/render";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId } = await requireDealAccess(rawDealId);

    const sb = supabaseAdmin();
    const buildResult = await buildForm155Input(dealId, bankId, sb);
    const rendered = await renderForm155Pdf({ supabase: sb, buildResult });

    if (!rendered.ok) {
      return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
    }

    return new NextResponse(rendered.pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="form-155-${dealId}.pdf"`,
      },
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/155/render]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
