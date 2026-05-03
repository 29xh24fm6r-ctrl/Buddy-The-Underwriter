import "server-only";

/**
 * GET /api/brokerage/deals/[dealId]/trident/latest-preview
 *
 * Returns the borrower's current succeeded preview bundle, if any, with
 * short-lived signed URLs for each artifact. Final bundles are NEVER
 * surfaced through this route — final release is gated behind lender pick
 * and lives on a separate surface.
 *
 * Auth follows the /trident/download/[kind] pattern: borrower must own
 * this deal via the `buddy_borrower_session` cookie. All failure modes
 * return 404 so the route does not leak the existence of other deals.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 300;

const ARTIFACT_COLUMNS = {
  business_plan: "business_plan_pdf_path",
  projections_pdf: "projections_pdf_path",
  projections_xlsx: "projections_xlsx_path",
  feasibility: "feasibility_pdf_path",
} as const;

type ArtifactKind = keyof typeof ARTIFACT_COLUMNS;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;

  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const sb = supabaseAdmin();
  const { data: bundle } = await sb
    .from("buddy_trident_bundles")
    .select("*")
    .eq("deal_id", dealId)
    .eq("mode", "preview")
    .eq("status", "succeeded")
    .is("superseded_at", null)
    .maybeSingle();

  if (!bundle) {
    return NextResponse.json({ ok: true, bundle: null, artifacts: {} });
  }

  const artifacts: Partial<Record<ArtifactKind, { url: string }>> = {};
  for (const [kind, column] of Object.entries(ARTIFACT_COLUMNS) as [
    ArtifactKind,
    string,
  ][]) {
    const path = (bundle as Record<string, unknown>)[column] as string | null;
    if (!path) continue;
    const { data: signed } = await sb.storage
      .from("trident-bundles")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signed?.signedUrl) artifacts[kind] = { url: signed.signedUrl };
  }

  return NextResponse.json({
    ok: true,
    bundle: {
      id: bundle.id,
      mode: bundle.mode,
      generatedAt: bundle.generated_at,
      redactorVersion: bundle.redactor_version,
    },
    artifacts,
  });
}
