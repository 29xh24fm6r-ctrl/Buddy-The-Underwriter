import "server-only";

/**
 * GET /api/portal/[token]/trident/latest-preview
 *
 * Returns the borrower-portal current succeeded preview bundle for the
 * deal bound to this portal token. Final bundles are NEVER surfaced
 * through this route — final release is gated behind Sprint 6 lender
 * pick and lives on a separate surface.
 *
 * Returns null when no preview exists, so the portal UI can show the
 * "Generate My Preview" empty state.
 *
 * All failure modes return 404 (never 403) — same leak-resistant pattern
 * as the cookie-scoped equivalent and the existing /trident/download.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePortalToken } from "@/lib/brokerage/trident/portalTokenAuth";

export const runtime = "nodejs";

export async function GET(
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

  const { data: bundle } = await sb
    .from("buddy_trident_bundles")
    .select(
      "id, deal_id, mode, status, version, business_plan_pdf_path, projections_pdf_path, projections_xlsx_path, feasibility_pdf_path, generation_error, generated_at, redactor_version",
    )
    .eq("deal_id", dealId)
    .eq("mode", "preview")
    .eq("status", "succeeded")
    .is("superseded_at", null)
    .maybeSingle();

  if (!bundle) {
    return NextResponse.json({ ok: true, bundle: null });
  }

  return NextResponse.json({
    ok: true,
    bundle: {
      id: bundle.id as string,
      dealId: bundle.deal_id as string,
      mode: bundle.mode as "preview",
      status: bundle.status as "succeeded",
      version: bundle.version as number,
      businessPlanPdfPath:
        (bundle.business_plan_pdf_path as string | null) ?? null,
      projectionsPdfPath:
        (bundle.projections_pdf_path as string | null) ?? null,
      projectionsXlsxPath:
        (bundle.projections_xlsx_path as string | null) ?? null,
      feasibilityPdfPath:
        (bundle.feasibility_pdf_path as string | null) ?? null,
      generationError: (bundle.generation_error as string | null) ?? null,
      generatedAt: (bundle.generated_at as string | null) ?? null,
      redactorVersion: (bundle.redactor_version as string | null) ?? null,
    },
  });
}
