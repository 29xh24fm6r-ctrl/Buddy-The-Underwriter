import "server-only";

/** Download the immutable files from one completed package run. */
import JSZip from "jszip";
import {
  LENDER_PACKAGE_FILES,
  canBorrowerDownload,
  packageFilesForActor,
} from "@/lib/brokerage/lenderPackageFiles";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { resolveLenderIdentity } from "@/lib/brokerage/lenderAuth";
import { auditPackageDownload } from "@/lib/brokerage/packageDelivery";
import { getLatestAssembledPackageRun } from "@/lib/sba/package/getLatestAssembledPackageRun";
import { OUTPUT_BUCKET as SBA_PACKAGE_BUCKET } from "@/lib/sba/package/assembleTenTabPackage";

export const runtime = "nodejs";
export const maxDuration = 300;

type TridentKind =
  | "business_plan"
  | "projections_pdf"
  | "projections_xlsx"
  | "feasibility"
  | "credit_memo"
  | "spreads"
  | "sba_forms";

const VALID_TRIDENT_KINDS: readonly TridentKind[] = [
  "business_plan",
  "projections_pdf",
  "projections_xlsx",
  "feasibility",
  "credit_memo",
  "spreads",
  "sba_forms",
] as const;

const KIND_TO_PATH_COLUMN: Record<TridentKind, string> = {
  business_plan: "business_plan_pdf_path",
  projections_pdf: "projections_pdf_path",
  projections_xlsx: "projections_xlsx_path",
  feasibility: "feasibility_pdf_path",
  credit_memo: "credit_memo_pdf_path",
  spreads: "spreads_pdf_path",
  sba_forms: "sba_forms_pdf_path",
};

class PackageStateUnavailable extends Error {}

type ResolvedActor = {
  bankId: string;
  actor: string;
  actorScope: "borrower" | "lender";
  /**
   * Mirrors marketplace_package_access.access_level. Only a `full` grant may
   * reach final-mode artifacts, the on-demand credit memo, or the assembled
   * SBA forms; a `preview` grant is confined to the preview bundle, matching
   * how packageDelivery tiers the manifest. The borrower owns the deal and is
   * always `full`.
   *
   * Previously this route read the grant's existence, bank, and revocation but
   * never its level, so any future preview-tier grant would have received the
   * complete final package (audit F-03).
   */
  accessLevel: "full" | "preview";
};

async function resolveActor(
  req: NextRequest,
  dealId: string,
): Promise<ResolvedActor | null> {
  const session = await getBorrowerSession();
  if (session && session.deal_id === dealId) {
    return {
      bankId: session.bank_id,
      actor: session.deal_id,
      actorScope: "borrower",
      accessLevel: "full",
    };
  }

  const accessId = req.nextUrl.searchParams.get("accessId");
  if (!accessId) return null;

  const lender = await resolveLenderIdentity();
  if (!lender) return null;

  const sb = supabaseAdmin();
  const { data: access, error: accessError } = await sb
    .from("marketplace_package_access")
    .select("id, lender_bank_id, deal_id, revoked_at, access_level")
    .eq("id", accessId)
    .maybeSingle();
  if (accessError)
    throw new PackageStateUnavailable("lender_access_read_failed");

  if (
    !access ||
    (access as any).deal_id !== dealId ||
    (access as any).lender_bank_id !== lender.lenderBankId ||
    (access as any).revoked_at
  ) {
    return null;
  }

  const { data: deal, error: dealError } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealError)
    throw new PackageStateUnavailable("deal_ownership_read_failed");
  if (!deal?.bank_id) return null;

  return {
    bankId: String(deal.bank_id),
    actor: lender.userId,
    actorScope: "lender",
    accessLevel: (access as any).access_level === "full" ? "full" : "preview",
  };
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

  const audit = await auditPackageDownload(
    {
      actor: actorInfo.actor,
      actorScope: actorInfo.actorScope,
      dealId,
      action: "package_download",
      resourceType: "sba_forms",
    },
    sb as any,
  );
  if (!audit.ok) {
    return NextResponse.json(
      { ok: false, error: "download_audit_persistence_failed" },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, url: signed.signedUrl });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string; kind: string }> },
): Promise<NextResponse> {
  const { dealId, kind } = await params;

  if (
    kind !== "complete_package" &&
    !VALID_TRIDENT_KINDS.includes(kind as TridentKind)
  ) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  let actorInfo: ResolvedActor | null;
  try {
    actorInfo = await resolveActor(req, dealId);
  } catch (error) {
    if (error instanceof PackageStateUnavailable) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 503 },
      );
    }
    throw error;
  }
  if (!actorInfo) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (actorInfo.actorScope === "borrower" && !canBorrowerDownload(kind))
    return NextResponse.json({ ok: false }, { status: 404 });

  // A preview-tier grant never reaches the certified committee artifacts.
  if (
    actorInfo.accessLevel !== "full" &&
    [
      "credit_memo",
      "sba_forms",
      "spreads",
      "complete_package",
      "projections_xlsx",
    ].includes(kind)
  ) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const sb = supabaseAdmin();

  // Prefer final, fall back to preview. Two small queries are clearer than a
  // clever ORDER BY. A preview-tier grant skips the final lookup entirely so
  // it can only ever be served the redacted preview bundle.
  const finalResult =
    actorInfo.accessLevel === "full"
      ? await sb
          .from("buddy_trident_bundles")
          .select("*")
          .eq("deal_id", dealId)
          .eq("mode", "final")
          .eq("status", "succeeded")
          .is("superseded_at", null)
          .maybeSingle()
      : { data: null, error: null };
  if (finalResult.error) {
    return NextResponse.json(
      { ok: false, error: "package_state_unavailable" },
      { status: 503 },
    );
  }

  let bundle = finalResult.data;
  if (
    !bundle &&
    ![
      "credit_memo",
      "spreads",
      "complete_package",
      "sba_forms",
      "projections_xlsx",
    ].includes(kind)
  ) {
    const previewResult = await sb
      .from("buddy_trident_bundles")
      .select("*")
      .eq("deal_id", dealId)
      .eq("mode", "preview")
      .eq("status", "succeeded")
      .is("superseded_at", null)
      .maybeSingle();
    if (previewResult.error) {
      return NextResponse.json(
        { ok: false, error: "package_state_unavailable" },
        { status: 503 },
      );
    }
    bundle = previewResult.data;
  }

  if (!bundle) {
    if (kind === "sba_forms") return handleSbaFormsDownload(dealId, actorInfo);
    return NextResponse.json(
      { ok: false, error: "Generate the complete lender package first." },
      { status: 404 },
    );
  }
  if (kind === "complete_package") {
    if (
      bundle.mode !== "final" ||
      !LENDER_PACKAGE_FILES.every((file) => bundle[file.column])
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The package is missing required documents. Rebuild it before downloading.",
        },
        { status: 409 },
      );
    }
    const zip = new JSZip();
    for (const file of packageFilesForActor(actorInfo.actorScope)) {
      const { data, error } = await sb.storage
        .from("trident-bundles")
        .download(bundle[file.column]);
      if (error || !data)
        return NextResponse.json(
          { ok: false, error: `${file.label} could not be downloaded.` },
          { status: 503 },
        );
      const bytes = Buffer.from(await data.arrayBuffer());
      const valid = file.filename.endsWith(".pdf")
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : bytes.subarray(0, 2).toString() === "PK";
      if (!valid)
        return NextResponse.json(
          { ok: false, error: `${file.label} is not a valid document.` },
          { status: 503 },
        );
      zip.file(file.filename, bytes);
    }
    zip.file(
      "Read-me.txt",
      `Prepared loan package\nRun: ${bundle.id}\nGenerated: ${bundle.generation_completed_at}\n\nPrepared for lender review, not credit approval. The lender confirms applicable requirements, signatures, business tax transcript requests and closing documents.\n`,
    );
    const audit = await auditPackageDownload(
      {
        actor: actorInfo.actor,
        actorScope: actorInfo.actorScope,
        dealId,
        action: "package_download",
        resourceType: kind,
        metadata: { bundleId: bundle.id },
      },
      sb,
    );
    if (!audit.ok)
      return NextResponse.json(
        { ok: false, error: "download_audit_persistence_failed" },
        { status: 503 },
      );
    return new NextResponse(
      new Uint8Array(
        await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
      ),
      {
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="lender-package.zip"',
          "cache-control": "private, no-store",
        },
      },
    );
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

  // The three Trident artifacts are the deliverable, and a lender holding a
  // marketplace grant reaches them through this same branch. They were the
  // only downloads on this route that wrote no marketplace_audit_log entry —
  // pulling the credit memo was recorded, pulling the business plan,
  // projections workbook, and feasibility study was not (audit F-21).
  const audit = await auditPackageDownload(
    {
      actor: actorInfo.actor,
      actorScope: actorInfo.actorScope,
      dealId,
      action: "package_download",
      resourceType: kind,
      metadata: { mode: bundle.mode, accessLevel: actorInfo.accessLevel },
    },
    sb as any,
  );
  if (!audit.ok) {
    return NextResponse.json(
      { ok: false, error: "download_audit_persistence_failed" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    url: signed.signedUrl,
    mode: bundle.mode as "preview" | "final",
  });
}
