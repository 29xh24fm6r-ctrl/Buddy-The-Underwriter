import "server-only";

/** SPEC S2 D-5 — GET /api/deals/[dealId]/sba/forms/1919/render */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildForm1919Input } from "@/lib/sba/forms/form1919/inputBuilder";
import { buildForm1919 } from "@/lib/sba/forms/form1919/build";
import { renderForm1919Pdf } from "@/lib/sba/forms/form1919/render";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await requireDealAccess(rawDealId);

    const sb = supabaseAdmin();
    const input = await buildForm1919Input(dealId, sb);
    const buildResult = buildForm1919(input);
    const rendered = await renderForm1919Pdf({ supabase: sb, buildResult });

    if (!rendered.ok) {
      return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
    }

    return new NextResponse(rendered.pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="form-1919-${dealId}.pdf"`,
      },
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/1919/render]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
