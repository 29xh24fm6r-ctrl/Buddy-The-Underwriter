import "server-only";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPackageArchive, PackageArchiveError } from "./packageArchive";
import type { TridentDistributionBinding } from "./buildSealedSnapshot";
import type { PackageCompletion } from "./packageCompletion";
import { assertTridentInputSnapshot } from "./trident/tridentInputSnapshot";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Create once, then prove durable bytes even when a concurrent retry won the upload. */
export async function persistPackageBytes(sb: SupabaseClient, path: string, bytes: Buffer, contentType: string) {
  const bucket = sb.storage.from("trident-bundles");
  await bucket.upload(path, bytes, { contentType, cacheControl: "0", upsert: false });
  const stored = await bucket.download(path);
  if (stored.error || !stored.data || stored.data.size !== bytes.length ||
      !Buffer.from(await stored.data.arrayBuffer()).equals(bytes))
    throw new PackageArchiveError("The complete package could not be saved and verified. Please retry.");
}

/** No seal/listing is committed until every generated and source file is durably archived. */
export async function certifyCompletePackage(args: {
  sb: SupabaseClient; dealId: string; bankId: string; binding: TridentDistributionBinding;
}): Promise<PackageCompletion> {
  const { sb, dealId, bankId, binding } = args;
  const result = await sb.from("buddy_trident_bundles").select("*")
    .eq("id", binding.bundleId).eq("deal_id", dealId).eq("bank_id", bankId)
    .eq("mode", "final").eq("status", "succeeded").is("superseded_at", null).maybeSingle();
  const bundle = result.data;
  if (result.error || !bundle || bundle.input_hash !== binding.inputHash || bundle.release_gate_json?.ok !== true)
    throw new PackageArchiveError("The prepared package changed or could not be read. Refresh before submitting.");
  const paths = { businessPlan: bundle.business_plan_pdf_path, projectionsXlsx: bundle.projections_xlsx_path,
    feasibility: bundle.feasibility_pdf_path, creditMemo: bundle.credit_memo_pdf_path,
    spreads: bundle.spreads_pdf_path, sbaForms: bundle.sba_forms_pdf_path };
  if (Object.entries(paths).some(([key, value]) => !value || value !== binding.artifacts[key as keyof typeof paths]))
    throw new PackageArchiveError("The prepared documents changed. Refresh before submitting.");
  const archive = await buildPackageArchive({ sb, bundle, dealId, bankId, actor: "lender" });
  const archivePath = `${dealId}/final/${bundle.id}/archives/lender/complete_package/${archive.sha256}.zip`;
  await persistPackageBytes(sb, archivePath, archive.bytes, "application/zip");
  // Storage work may take time. Recheck admission evidence before the transaction.
  await assertTridentInputSnapshot({ sb, dealId, expectedHash: binding.inputHash, expectedManifest: bundle.snapshot_manifest_json });
  return { version: 1, dealId, bankId, bundleId: bundle.id, inputHash: binding.inputHash,
    verifiedAt: new Date().toISOString(), archivePath, sha256: archive.sha256,
    sizeBytes: archive.bytes.length, inventory: archive.inventory };
}

/** Deliver from the verified frozen archive, never from later edits to source uploads. */
export async function readCertifiedPackage(sb: SupabaseClient, proof: PackageCompletion,
  actor: "borrower" | "lender", kind: string) {
  const stored = await sb.storage.from("trident-bundles").download(proof.archivePath);
  if (stored.error || !stored.data || stored.data.size !== proof.sizeBytes)
    throw new PackageArchiveError("The saved complete package is unavailable. Please retry.");
  const bytes = Buffer.from(await stored.data.arrayBuffer());
  if (hash(bytes) !== proof.sha256) throw new PackageArchiveError("The saved package failed its integrity check. No files were released.");
  const original = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const isArchive = ["complete_package", "source_docs"].includes(kind);
  const files = proof.inventory.files.filter(file =>
    (actor === "lender" || file.borrowerVisible === true) &&
    (kind === "complete_package" || (kind === "source_docs" ? file.category === "source" : file.kind === kind)));
  if (!isArchive && files.length !== 1) throw new PackageArchiveError("This document is not part of the sealed package.");
  const zip = new JSZip();
  for (const file of files) {
    const entry = original.file(file.filename);
    if (!entry) throw new PackageArchiveError("A saved package document is missing.");
    const content = await entry.async("nodebuffer");
    if (content.length !== file.sizeBytes || hash(content) !== file.sha256)
      throw new PackageArchiveError("A saved document failed its integrity check.");
    if (!isArchive) return { bytes: content, sha256: file.sha256, filename: file.filename, fileCount: 1 };
    zip.file(file.filename, content, { date: new Date("2000-01-01T00:00:00Z"), createFolders: false });
  }
  if (actor === "lender" && kind === "complete_package")
    return { bytes, sha256: proof.sha256, filename: "lender-package.zip", fileCount: files.length };
  zip.file("Package-inventory.json", JSON.stringify({ ...proof.inventory, actor, files }, null, 2), { date: new Date("2000-01-01T00:00:00Z") });
  zip.file("Read-me.txt", "Frozen application documents prepared for lender review, not credit approval. The lender confirms applicable requirements, signatures and closing documents.", { date: new Date("2000-01-01T00:00:00Z") });
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { bytes: output, sha256: hash(output), filename: kind === "source_docs" ? "source-documents.zip" : "lender-package.zip", fileCount: files.length };
}
