import "server-only";

/**
 * POST /api/portal/[token]/trident/preview
 *
 * Borrower-portal-scoped preview generation. Auth via the URL token
 * → borrower_portal_links lookup, NOT the buddy_borrower_session cookie.
 * The token never appears in the request body — it comes from the route
 * segment so a bad client can't spoof it.
 *
 * Mode is hard-coded to "preview". Final-mode generation is gated behind
 * Sprint 6 borrower-pick + lender-unlock and is invoked from a different
 * surface — never from the borrower portal directly.
 *
 * On assumptions blockers (missing revenue, missing loan amount, etc.)
 * the route returns:
 *   { ok: false, error: "missing_prerequisites", gaps: [...] }
 * with HTTP 200 so the portal UI can render a friendly checklist
 * without the browser fetch turning the response into an error.
 *
 * On other failures the bundle row records the error in
 * generation_error and the route returns the bundle in failed state.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePortalToken } from "@/lib/brokerage/trident/portalTokenAuth";
import { generateTridentBundle } from "@/lib/brokerage/trident/generateTridentBundle";
import { ensureAssumptionsForPreview } from "@/lib/sba/sbaAssumptionsBootstrap";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  const ctx = await resolvePortalToken(token);
  if (!ctx) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const { dealId } = ctx;
  const sb = supabaseAdmin();

  // Pull the borrower's concierge facts + transcript so the assumptions
  // bootstrap has full context. Both are optional — the bootstrap falls
  // back to prefill / defaults when they're absent.
  const { data: cs } = await sb
    .from("borrower_concierge_sessions")
    .select("extracted_facts")
    .eq("deal_id", dealId)
    .maybeSingle();

  const ensure = await ensureAssumptionsForPreview({
    dealId,
    conciergeFacts:
      (cs?.extracted_facts as Record<string, unknown>) ?? null,
    sb,
  });
  if (!ensure.ok) {
    return NextResponse.json({
      ok: false,
      error: "missing_prerequisites",
      gaps: ensure.blockers,
    });
  }

  const result = await generateTridentBundle({ dealId, mode: "preview" });

  // Whether ok or failed, surface the bundle row's current state so the
  // borrower UI can render generation_error and the friendly "Try Again"
  // path. The generator already persists status + generation_error.
  const { data: bundle } = await sb
    .from("buddy_trident_bundles")
    .select(
      "id, deal_id, mode, status, version, business_plan_pdf_path, projections_pdf_path, projections_xlsx_path, feasibility_pdf_path, generation_error, generated_at",
    )
    .eq("id", result.bundleId ?? "")
    .maybeSingle();

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "generation_failed",
        bundle: bundle
          ? shapeBundle(bundle)
          : null,
        message: result.error,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    bundle: bundle ? shapeBundle(bundle) : null,
  });
}

function shapeBundle(b: Record<string, unknown>) {
  return {
    id: b.id as string,
    dealId: b.deal_id as string,
    mode: b.mode as "preview" | "final",
    status: b.status as "pending" | "running" | "succeeded" | "failed",
    version: b.version as number,
    businessPlanPdfPath: (b.business_plan_pdf_path as string | null) ?? null,
    projectionsPdfPath: (b.projections_pdf_path as string | null) ?? null,
    projectionsXlsxPath: (b.projections_xlsx_path as string | null) ?? null,
    feasibilityPdfPath: (b.feasibility_pdf_path as string | null) ?? null,
    generationError: (b.generation_error as string | null) ?? null,
    generatedAt: (b.generated_at as string | null) ?? null,
  };
}
