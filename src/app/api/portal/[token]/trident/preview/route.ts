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
 * Generation is ADMITTED here and executed by the durable workflow, not
 * awaited in-request. This route used to await the inline generator —
 * a full preview run (LLM business plan, AI verifier pass, feasibility
 * engine, several PDF renders) inside a 300s ceiling. On timeout the
 * function was reclaimed mid-run and the bundle kept a 90-minute lease in
 * `running`; the janitor only reclaims once that lease expires, so the
 * borrower's next "Generate My Preview" was refused for up to an hour and
 * a half. Audit F-04 fixed the three other trigger surfaces; this one was
 * missed (audit F-17).
 *
 * The response is 202 with { accepted: true }. TridentPreviewCard already
 * polls latest-preview while it shows "generating", which is how the
 * finished bundle reaches the borrower.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePortalToken } from "@/lib/brokerage/trident/portalTokenAuth";
import { startTridentGeneration } from "@/lib/brokerage/trident/startTridentGeneration";
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

  const started = await startTridentGeneration({ dealId, mode: "preview" });

  // Admission failed outright (no lease taken, nothing running). Surface the
  // bundle row when there is one so the UI keeps its "Try Again" path.
  if (!started.ok) {
    const { data: bundle } = started.bundleId
      ? await sb
          .from("buddy_trident_bundles")
          .select(
            "id, deal_id, mode, status, version, business_plan_pdf_path, projections_pdf_path, projections_xlsx_path, feasibility_pdf_path, generation_error, generated_at",
          )
          .eq("id", started.bundleId)
          .maybeSingle()
      : { data: null };
    return NextResponse.json(
      {
        ok: false,
        error: "generation_failed",
        bundle: bundle ? shapeBundle(bundle) : null,
        message: started.error,
      },
      { status: 200 },
    );
  }

  // Accepted. An already-running lease is the correct answer, not an error:
  // admission is atomic, so a second click joins the run in flight.
  return NextResponse.json(
    {
      ok: true,
      accepted: true,
      bundleId: started.bundleId,
      alreadyRunning: started.alreadyRunning === true,
    },
    { status: 202 },
  );
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
