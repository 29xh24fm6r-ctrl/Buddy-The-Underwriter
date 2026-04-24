import "server-only";

/**
 * GET /api/brokerage/deals/[dealId]/trident/download/[kind]
 *
 * S3-4: borrower must own this deal via their session cookie. The raw token
 * lives only in the `buddy_borrower_session` cookie; we hash + look up; the
 * looked-up session's deal_id must equal the URL's [dealId].
 *
 * Failure modes all return 404 — never 403 — so we don't leak the existence
 * of other deals to a probing caller.
 *
 * Returns the current succeeded bundle. Prefers mode=final; falls back to
 * mode=preview.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";

export const runtime = "nodejs";

type TridentKind =
  | "business_plan"
  | "projections_pdf"
  | "projections_xlsx"
  | "feasibility";

const VALID_KINDS: readonly TridentKind[] = [
  "business_plan",
  "projections_pdf",
  "projections_xlsx",
  "feasibility",
] as const;

const KIND_TO_PATH_COLUMN: Record<TridentKind, string> = {
  business_plan: "business_plan_pdf_path",
  projections_pdf: "projections_pdf_path",
  projections_xlsx: "projections_xlsx_path",
  feasibility: "feasibility_pdf_path",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string; kind: string }> },
): Promise<NextResponse> {
  const { dealId, kind } = await params;

  if (!VALID_KINDS.includes(kind as TridentKind)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // S3-4: borrower must own this deal via session cookie.
  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const sb = supabaseAdmin();

  // Prefer final, fall back to preview. Two small queries are clearer than a
  // clever ORDER BY.
  const { data: finalBundle } = await sb
    .from("buddy_trident_bundles")
    .select("*")
    .eq("deal_id", dealId)
    .eq("mode", "final")
    .eq("status", "succeeded")
    .is("superseded_at", null)
    .maybeSingle();

  const bundle =
    finalBundle ??
    (await sb
      .from("buddy_trident_bundles")
      .select("*")
      .eq("deal_id", dealId)
      .eq("mode", "preview")
      .eq("status", "succeeded")
      .is("superseded_at", null)
      .maybeSingle()).data;

  if (!bundle) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const pathColumn = KIND_TO_PATH_COLUMN[kind as TridentKind];
  const storagePath = (bundle as Record<string, unknown>)[pathColumn] as
    | string
    | null;
  if (!storagePath) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const { data: signed, error } = await sb.storage
    .from("trident-bundles")
    .createSignedUrl(storagePath, 300); // 5-minute TTL
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    url: signed.signedUrl,
    mode: bundle.mode as "preview" | "final",
  });
}
