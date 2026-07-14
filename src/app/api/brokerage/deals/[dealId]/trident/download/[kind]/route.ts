import "server-only";

/**
 * GET /api/brokerage/deals/[dealId]/trident/download/[kind]
 *
 * S3-4: borrower must own this deal via their session cookie. The raw token
 * lives only in the `buddy_borrower_session` cookie; we hash + look up; the
 * looked-up session's deal_id must equal the URL's [dealId]. A lender with a
 * valid `marketplace_package_access` grant (passed as `?accessId=`) may also
 * download — same check as /api/lender/marketplace/package/[accessId].
 *
 * Failure modes all return 404 — never 403 — so we don't leak the existence
 * of other deals to a probing caller.
 *
 * For business_plan/projections_pdf/projections_xlsx/feasibility: returns a
 * signed Storage URL for the current succeeded trident bundle (prefers
 * mode=final; falls back to mode=preview).
 *
 * For credit_memo: there is no pre-generated static file to sign a URL for —
 * buddy_sealed_packages.final_credit_memo_path is never populated anywhere in
 * this codebase. Instead this renders the PDF on demand from the same
 * certified pipeline the internal committee PDF route uses
 * (loadLatestCertifiedFloridaArmorySnapshot + assertCommitteeMemoSafe +
 * buildCreditMemoPdf) and streams the bytes directly, keyed by the same
 * [kind] dynamic segment rather than a separate route file — this repo has a
 * hard Vercel serverless-function slot budget (routeConsolidationGuard.test.ts)
 * with a documented history of production outages from exceeding it, so new
 * download capabilities extend an existing dispatcher instead of adding a
 * new route.ts. This also replaces reliance on createSignedPackageDownload()
 * in packageDelivery.ts, which built an entirely unsigned URL pointing at a
 * route that never existed.
 *
 * For sba_forms: the merged 10-tab package (assembleTenTabPackage.ts) lives
 * in the `bank-forms` bucket, not `trident-bundles` — a separate signed-URL
 * branch (not KIND_TO_PATH_COLUMN) resolves the most recently assembled
 * sba_package_runs row for this deal via getLatestAssembledPackageRun. Note
 * the 10-tab assembly pipeline (prepare → generate → assemble) is NOT
 * triggered automatically anywhere yet (unlike the trident bundle, which is
 * generated at pick time) — it must have been run manually via the
 * sba/route.ts action dispatch for this to have anything to serve.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { resolveLenderIdentity } from "@/lib/brokerage/lenderAuth";
import { loadLatestCertifiedFloridaArmorySnapshot } from "@/lib/creditMemo/snapshot/loadLatestCertifiedSnapshot";
import { assertCommitteeMemoSafe } from "@/lib/creditMemo/snapshot/assertCommitteeMemoSafe";
import { FloridaArmoryBuildError } from "@/lib/creditMemo/snapshot/types";
import { buildCreditMemoPdf } from "@/lib/creditMemo/pdf/buildCreditMemoPdf";
import { auditPackageDownload } from "@/lib/brokerage/packageDelivery";
import { getLatestAssembledPackageRun } from "@/lib/sba/package/getLatestAssembledPackageRun";
import { OUTPUT_BUCKET as SBA_PACKAGE_BUCKET } from "@/lib/sba/package/assembleTenTabPackage";

export const runtime = "nodejs";
export const maxDuration = 300;

type TridentKind =
  | "business_plan"
  | "projections_pdf"
  | "projections_xlsx"
  | "feasibility";

const VALID_TRIDENT_KINDS: readonly TridentKind[] = [
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

type ResolvedActor = {
  bankId: string;
  actor: string;
  actorScope: "borrower" | "lender";
};

async function resolveActor(
  req: NextRequest,
  dealId: string,
): Promise<ResolvedActor | null> {
  const session = await getBorrowerSession();
  if (session && session.deal_id === dealId) {
    return { bankId: session.bank_id, actor: session.deal_id, actorScope: "borrower" };
  }

  const accessId = req.nextUrl.searchParams.get("accessId");
  if (!accessId) return null;

  const lender = await resolveLenderIdentity();
  if (!lender) return null;

  const sb = supabaseAdmin();
  const { data: access } = await sb
    .from("marketplace_package_access")
    .select("id, lender_bank_id, deal_id, revoked_at")
    .eq("id", accessId)
    .maybeSingle();

  if (
    !access ||
    (access as any).deal_id !== dealId ||
    (access as any).lender_bank_id !== lender.lenderBankId ||
    (access as any).revoked_at
  ) {
    return null;
  }

  const { data: deal } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal?.bank_id) return null;

  return { bankId: String(deal.bank_id), actor: lender.userId, actorScope: "lender" };
}

async function handleCreditMemoDownload(
  dealId: string,
  actorInfo: ResolvedActor,
): Promise<NextResponse> {
  const { bankId, actor, actorScope } = actorInfo;

  const snapshotRes = await loadLatestCertifiedFloridaArmorySnapshot({ dealId, bankId });
  if (!snapshotRes.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          snapshotRes.reason === "not_found"
            ? "certified_snapshot_required"
            : "snapshot_load_failed",
      },
      { status: snapshotRes.reason === "not_found" ? 409 : 500 },
    );
  }

  try {
    assertCommitteeMemoSafe(snapshotRes.snapshot);
  } catch (guardErr: unknown) {
    if (guardErr instanceof FloridaArmoryBuildError) {
      return NextResponse.json(
        { ok: false, error: "committee_artifact_unsafe" },
        { status: 409 },
      );
    }
    throw guardErr;
  }

  const memo = snapshotRes.snapshot.canonical_memo;
  const pdfBuffer = await buildCreditMemoPdf(memo);

  await auditPackageDownload(
    { actor, actorScope, dealId, action: "package_download", resourceType: "credit_memo" },
    supabaseAdmin() as any,
  ).catch(() => {});

  const borrowerSlug = (memo.header.borrower_name ?? dealId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="credit-memo-${borrowerSlug}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

async function handleSbaFormsDownload(
  dealId: string,
  actorInfo: ResolvedActor,
): Promise<NextResponse> {
  const sb = supabaseAdmin();
  const run = await getLatestAssembledPackageRun(dealId, sb as any);
  if (!run) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const { data: signed, error } = await sb.storage
    .from(SBA_PACKAGE_BUCKET)
    .createSignedUrl(run.storagePath, 300); // 5-minute TTL
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  await auditPackageDownload(
    { actor: actorInfo.actor, actorScope: actorInfo.actorScope, dealId, action: "package_download", resourceType: "sba_forms" },
    sb as any,
  ).catch(() => {});

  return NextResponse.json({ ok: true, url: signed.signedUrl });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string; kind: string }> },
): Promise<NextResponse> {
  const { dealId, kind } = await params;

  if (
    kind !== "credit_memo" &&
    kind !== "sba_forms" &&
    !VALID_TRIDENT_KINDS.includes(kind as TridentKind)
  ) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const actorInfo = await resolveActor(req, dealId);
  if (!actorInfo) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (kind === "credit_memo") {
    return handleCreditMemoDownload(dealId, actorInfo);
  }

  if (kind === "sba_forms") {
    return handleSbaFormsDownload(dealId, actorInfo);
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
