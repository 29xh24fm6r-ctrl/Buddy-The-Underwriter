import "server-only";

/**
 * GET /api/portal/[token]/trident/download/[kind]
 *
 * Borrower-portal-scoped artifact download. PREVIEW-ONLY by contract:
 * never returns a final-mode bundle path, even if one exists. The
 * cookie-scoped /trident/download/[kind] (used by the brokerage `/start`
 * concierge surface) prefers final → preview; this portal-scoped route
 * is locked to mode="preview" because Sprint 6 lender pick / unlock has
 * not landed yet and final release must not leak to the borrower
 * pre-pick.
 *
 * `kind` is the dash-separated form ("business-plan", "projections",
 * "feasibility") matching the spec; we map to the underscored column
 * names internally.
 *
 * Auth: borrower_portal_links lookup. All failure modes return 404 so
 * the route can't be used to enumerate dealIds.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePortalToken } from "@/lib/brokerage/trident/portalTokenAuth";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 300;

const KIND_TO_PATH_COLUMN: Record<string, string> = {
  "business-plan": "business_plan_pdf_path",
  projections: "projections_pdf_path",
  feasibility: "feasibility_pdf_path",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string; kind: string }> },
): Promise<NextResponse> {
  const { token, kind } = await params;

  const pathColumn = KIND_TO_PATH_COLUMN[kind];
  if (!pathColumn) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const ctx = await resolvePortalToken(token);
  if (!ctx) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const { dealId } = ctx;
  const sb = supabaseAdmin();

  // PREVIEW-ONLY. Spec: borrower portal pre-pick must not touch final
  // bundles. The cookie-scoped download route is the surface that
  // prefers final → preview; this one does not.
  const { data: bundle } = await sb
    .from("buddy_trident_bundles")
    .select("*")
    .eq("deal_id", dealId)
    .eq("mode", "preview")
    .eq("status", "succeeded")
    .is("superseded_at", null)
    .maybeSingle();

  if (!bundle) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const storagePath = (bundle as Record<string, unknown>)[pathColumn] as
    | string
    | null;
  if (!storagePath) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const { data: signed, error } = await sb.storage
    .from("trident-bundles")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    url: signed.signedUrl,
    mode: "preview",
  });
}
