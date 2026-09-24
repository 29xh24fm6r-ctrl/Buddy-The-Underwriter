import "server-only";

/** Download the immutable files from one completed package run. */
import { persistPackageBytes, readCertifiedPackage } from "@/lib/brokerage/certifyCompletePackage";
import { readPackageCompletion } from "@/lib/brokerage/packageCompletion";
import { buildPackageArchive, PackageArchiveError } from "@/lib/brokerage/packageArchive";
import { getBorrowerArtifactRelease } from "@/lib/brokerage/borrowerArtifactRelease";
import {
  canBorrowerDownload,
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
  sealedPackageId?: string;
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
    .select("id, lender_bank_id, deal_id, revoked_at, access_level, sealed_package_id")
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
    sealedPackageId: access.sealed_package_id ?? undefined,
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
    kind !== "complete_package" && kind !== "source_docs" &&
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
      "source_docs",
      "projections_xlsx",
    ].includes(kind)
  ) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const sb = supabaseAdmin();

  if (actorInfo.actorScope === "borrower" && kind !== "sba_forms") {
    const release = await getBorrowerArtifactRelease(dealId, sb);
    actorInfo.sealedPackageId = release.sealedPackageId;
    if (!release.released) return NextResponse.json(
      { ok: false, error: release.reason },
      { status: release.reason === "state_unavailable" ? 503 : 403 },
    );
  }

  // Forms remain reviewable before submission; once sealed they use the same
  // immutable binding as every other final document.
  if (actorInfo.actorScope === "borrower" && kind === "sba_forms") {
    const active = await sb.from("buddy_sealed_packages").select("id")
      .eq("deal_id", dealId).eq("bank_id", actorInfo.bankId).is("unsealed_at", null).maybeSingle();
    if (active.error) return NextResponse.json({ ok: false, error: "package_state_unavailable" }, { status: 503 });
    actorInfo.sealedPackageId = active.data?.id;
  }
  let boundBundleId: string | null = null;
  let sealedSnapshot: any = null;
  const bindingRequired = actorInfo.accessLevel === "full" &&
    !(actorInfo.actorScope === "borrower" && kind === "sba_forms" && !actorInfo.sealedPackageId);
  if (bindingRequired) {
    if (!actorInfo.sealedPackageId) return NextResponse.json({ ok: false, error: "Package release binding is unavailable." }, { status: 409 });
    const sealed = await sb.from("buddy_sealed_packages").select("sealed_snapshot")
      .eq("id", actorInfo.sealedPackageId).eq("deal_id", dealId).eq("bank_id", actorInfo.bankId)
      .is("unsealed_at", null).maybeSingle();
    if (sealed.error) return NextResponse.json({ ok: false, error: "package_state_unavailable" }, { status: 503 });
    sealedSnapshot = sealed.data?.sealed_snapshot;
    boundBundleId = sealedSnapshot?.tridentFinal?.bundleId ?? null;
    if (!boundBundleId) return NextResponse.json({ ok: false, error: "Package release binding is unavailable." }, { status: 409 });
  }

  async function recheckRelease() {
    try {
      const current = await resolveActor(req, dealId);
      const release = actorInfo!.actorScope === "borrower" && kind !== "sba_forms" ? await getBorrowerArtifactRelease(dealId, sb) : null;
      if (!current || current.actor !== actorInfo!.actor || current.actorScope !== actorInfo!.actorScope ||
          current.bankId !== actorInfo!.bankId || current.accessLevel !== actorInfo!.accessLevel ||
          (current.actorScope === "lender" && current.sealedPackageId !== actorInfo!.sealedPackageId) ||
          (release && (!release.released || release.sealedPackageId !== actorInfo!.sealedPackageId)))
        return NextResponse.json({ ok: false, error: "Package access changed. Refresh before downloading." }, { status: release?.reason === "state_unavailable" ? 503 : 403 });
      if (boundBundleId) {
        const seal = await sb.from("buddy_sealed_packages").select("sealed_snapshot")
          .eq("id", actorInfo!.sealedPackageId).eq("deal_id", dealId).eq("bank_id", actorInfo!.bankId).is("unsealed_at", null).maybeSingle();
        if (seal.error) return NextResponse.json({ ok: false, error: "package_state_unavailable" }, { status: 503 });
        if (seal.data?.sealed_snapshot?.tridentFinal?.bundleId !== boundBundleId)
          return NextResponse.json({ ok: false, error: "Package release changed. Refresh before downloading." }, { status: 409 });
      }
      return null;
    } catch { return NextResponse.json({ ok: false, error: "package_state_unavailable" }, { status: 503 }); }
  }

  if (sealedSnapshot?.packageCompletion) {
    const proof = readPackageCompletion(sealedSnapshot, dealId, actorInfo.bankId);
    if (!proof) return NextResponse.json({ ok: false, error: "Package completion evidence is invalid." }, { status: 409 });
    if (kind === "projections_pdf") return NextResponse.json({ ok: false }, { status: 404 });
    try {
      const file = await readCertifiedPackage(sb, proof, actorInfo.actorScope, kind);
      const path = `${dealId}/final/${proof.bundleId}/archives/${actorInfo.actorScope}/${kind}/${file.sha256}/${file.filename}`;
      const contentType = file.filename.endsWith(".zip") ? "application/zip" : file.filename.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
      await persistPackageBytes(sb, path, file.bytes, contentType);
      const changed = await recheckRelease();
      if (changed) return changed;
      const audit = await auditPackageDownload({ actor: actorInfo.actor, actorScope: actorInfo.actorScope, dealId,
        action: "package_download", resourceType: kind, metadata: { bundleId: proof.bundleId,
          sealedPackageId: actorInfo.sealedPackageId, sha256: file.sha256, fileCount: file.fileCount } }, sb);
      if (!audit.ok) return NextResponse.json({ ok: false, error: "download_audit_persistence_failed" }, { status: 503 });
      const signed = await sb.storage.from("trident-bundles").createSignedUrl(path, 60, { download: file.filename });
      if (signed.error || !signed.data?.signedUrl) throw new PackageArchiveError("The download link could not be created. Please retry.");
      if (req.nextUrl.searchParams.get("redirect") === "1")
        return new NextResponse(null, { status: 303, headers: { location: signed.data.signedUrl, "cache-control": "private, no-store" } });
      return NextResponse.json({ ok: true, url: signed.data.signedUrl, mode: "final", bundleId: proof.bundleId,
        fileCount: file.fileCount, sha256: file.sha256 }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof PackageArchiveError ? error.message : "The saved package could not be verified. Please retry." }, { status: 503 });
    }
  }

  // Historical releases retain exact bundle delivery; preview grants stay redacted.
  let finalQuery = sb.from("buddy_trident_bundles").select("*")
    .eq("deal_id", dealId).eq("bank_id", actorInfo.bankId).eq("mode", "final").eq("status", "succeeded").is("superseded_at", null);
  if (boundBundleId) finalQuery = finalQuery.eq("id", boundBundleId).eq("bank_id", actorInfo.bankId);
  const finalResult = actorInfo.accessLevel === "full" ? await finalQuery.maybeSingle() : { data: null, error: null };
  if (finalResult.error) {
    return NextResponse.json(
      { ok: false, error: "package_state_unavailable" },
      { status: 503 },
    );
  }

  let bundle = finalResult.data;
  if (
    !bundle && !boundBundleId &&
    ![
      "credit_memo",
      "spreads",
      "complete_package",
      "source_docs",
      "sba_forms",
      "projections_xlsx",
    ].includes(kind)
  ) {
    const previewResult = await sb
      .from("buddy_trident_bundles")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", actorInfo.bankId)
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
    if (kind === "sba_forms" && !bindingRequired) return handleSbaFormsDownload(dealId, actorInfo);
    return NextResponse.json(
      { ok: false, error: "Generate the complete lender package first." },
      { status: 404 },
    );
  }
  if (kind === "complete_package" || kind === "source_docs") {
    try {
      const archive = await buildPackageArchive({ sb, bundle, dealId, bankId: actorInfo.bankId,
        actor: actorInfo.actorScope, sourcesOnly: kind === "source_docs" });
      const filename = kind === "source_docs" ? "source-documents.zip" : "lender-package.zip";
      // Content-addressed, actor-specific objects prevent borrower/lender cache mixing.
      const archivePath = `${dealId}/final/${bundle.id}/archives/${actorInfo.actorScope}/${kind}/${archive.sha256}.zip`;
      const bucket = sb.storage.from("trident-bundles");
      const uploaded = await bucket.upload(archivePath, archive.bytes, {
        contentType: "application/zip", cacheControl: "0", upsert: false,
      });
      if (uploaded.error) {
        // A simultaneous identical download may win the create-once write.
        // Prove the existing object before issuing a URL; never ignore write failures.
        const existing = await bucket.download(archivePath);
        if (existing.error || !existing.data || !Buffer.from(await existing.data.arrayBuffer()).equals(archive.bytes))
          throw new PackageArchiveError("The package could not be saved for download. Please retry.");
      }
      const changed = await recheckRelease();
      if (changed) return changed;
      const audit = await auditPackageDownload({ actor: actorInfo.actor, actorScope: actorInfo.actorScope,
        dealId, action: "package_download", resourceType: kind,
        metadata: { bundleId: bundle.id, sealedPackageId: actorInfo.sealedPackageId,
          fileCount: archive.inventory.files.length, archiveSha256: archive.sha256 },
      }, sb);
      if (!audit.ok) return NextResponse.json({ ok: false, error: "download_audit_persistence_failed" }, { status: 503 });
      const signed = await bucket.createSignedUrl(archivePath, 60, { download: filename });
      if (signed.error || !signed.data?.signedUrl) throw new PackageArchiveError("The download link could not be created. Please retry.");
      // Browser anchors use a redirect; fetch clients receive the same signed URL as other artifacts.
      if (req.nextUrl.searchParams.get("redirect") === "1")
        return new NextResponse(null, { status: 303, headers: { location: signed.data.signedUrl, "cache-control": "private, no-store" } });
      return NextResponse.json({ ok: true, url: signed.data.signedUrl, bundleId: bundle.id,
        fileCount: archive.inventory.files.length, sha256: archive.sha256 }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof PackageArchiveError
        ? error.message : "The complete package could not be verified. Please retry." }, { status: 503 });
    }
  }

  const pathColumn = KIND_TO_PATH_COLUMN[kind as TridentKind];
  const storagePath = (bundle as Record<string, unknown>)[pathColumn] as
    | string
    | null;
  if (!storagePath) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const changed = await recheckRelease();
  if (changed) return changed;

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
    bundleId: bundle.id,
  }, { headers: { "cache-control": "private, no-store" } });
}
