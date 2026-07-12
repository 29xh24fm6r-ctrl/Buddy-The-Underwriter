import "server-only";

/**
 * SPEC S6 (ARC-00 Phase 4) — GET /api/deals/[dealId]/sba/forms/1244/[action]
 * action ∈ {"build", "render"}
 *
 * Consolidated into one dynamic-segment route (rather than separate
 * /1244/build and /1244/render directories, the pattern every earlier
 * phase's form routes used) per this arc's own Drift Log recommendation
 * (Phase 2/3: "design all new routes in Phases 3-6 using the catch-all
 * pattern from the start" — the route/page slot budget crossed its 1900
 * warning threshold in Phase 3). Halves the slot cost of adding this form
 * versus the established two-file convention.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildForm1244WithSignature } from "@/lib/sba/forms/form1244/buildWithSignature";
import { buildForm1244Input } from "@/lib/sba/forms/form1244/inputBuilder";
import { buildForm1244 } from "@/lib/sba/forms/form1244/build";
import { renderForm1244Pdf } from "@/lib/sba/forms/form1244/render";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; action: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, action } = await ctx.params;
    const { dealId } = await requireDealAccess(rawDealId);
    const sb = supabaseAdmin();

    if (action === "build") {
      const result = await buildForm1244WithSignature(dealId, sb);
      return NextResponse.json({ ok: true, dealId, ...result });
    }

    if (action === "render") {
      const input = await buildForm1244Input(dealId, sb);
      const buildResult = buildForm1244(input);
      const rendered = await renderForm1244Pdf({ supabase: sb, buildResult });

      if (!rendered.ok) {
        return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
      }

      return new NextResponse(rendered.pdfBytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="form-1244-${dealId}.pdf"`,
        },
      });
    }

    return NextResponse.json({ ok: false, error: `unsupported_action: ${action}` }, { status: 400 });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/1244/[action]]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
