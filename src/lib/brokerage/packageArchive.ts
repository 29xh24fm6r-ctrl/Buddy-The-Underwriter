import "server-only";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { packageFilesForActor, LENDER_PACKAGE_FILES } from "./lenderPackageFiles";
import { packageSourceDocuments } from "./packageEvidence";
import { defaultDocumentBucket, downloadDocumentBytes, verifyDocumentContentIdentity } from "@/lib/storage/documentBytes";

// Bound memory and stay below the existing private bucket's 50 MiB object limit.
export const PACKAGE_ARCHIVE_MAX_BYTES = 40 * 1024 * 1024;
const MAX_SOURCE_FILES = 200;
const ZIP_DATE = new Date("2000-01-01T00:00:00.000Z");
export type PackageArchiveInventory = {
  version: 1; bundleId: string; actor: "borrower" | "lender";
  files: Array<{ filename: string; category: "generated" | "source"; sizeBytes: number; sha256: string;
    kind?: string; pageCount?: number; borrowerVisible?: boolean;
    documentId?: string; documentType?: string | null; years?: number[]; reviewStatus?: string; identityStrength?: "sha256" | "size" }>;
};
export class PackageArchiveError extends Error {}

/** Assemble only frozen source rows; never mix newer uploads into an older package. */
export async function buildPackageArchive(args: {
  sb: SupabaseClient; bundle: Record<string, any>; dealId: string; bankId: string;
  actor: "borrower" | "lender"; sourcesOnly?: boolean;
}) {
  const { sb, bundle, dealId, bankId, actor } = args;
  if (bundle.deal_id !== dealId || bundle.bank_id !== bankId || bundle.mode !== "final" || bundle.status !== "succeeded" ||
      !LENDER_PACKAGE_FILES.every(file => bundle[file.column]))
    throw new PackageArchiveError("The package is missing required documents. Rebuild it before downloading.");
  let sources;
  try { sources = packageSourceDocuments(bundle.snapshot_manifest_json, dealId, bankId, actor); }
  catch (error) { throw new PackageArchiveError((error as Error).message); }
  if (sources.length > MAX_SOURCE_FILES || sources.reduce((n, doc) => n + doc.size_bytes, 0) > PACKAGE_ARCHIVE_MAX_BYTES)
    throw new PackageArchiveError("This package exceeds the download size limit. Contact Buddy support for secure delivery.");
  const zip = new JSZip();
  const inventory: PackageArchiveInventory = { version: 1, bundleId: bundle.id, actor, files: [] };
  let total = 0;
  function add(filename: string, bytes: Uint8Array, details: Omit<PackageArchiveInventory["files"][number], "filename" | "sizeBytes" | "sha256">) {
    total += bytes.byteLength;
    if (total > PACKAGE_ARCHIVE_MAX_BYTES) throw new PackageArchiveError("This package exceeds the download size limit. Contact Buddy support for secure delivery.");
    inventory.files.push({ filename, ...details, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
    zip.file(filename, bytes, { date: ZIP_DATE, createFolders: false });
  }
  if (!args.sourcesOnly) for (const file of packageFilesForActor(actor)) {
    try {
      const { data, error } = await sb.storage.from("trident-bundles").download(bundle[file.column]);
      if (error || !data) throw new Error("missing");
      if (data.size + total > PACKAGE_ARCHIVE_MAX_BYTES) throw new PackageArchiveError("This package exceeds the download size limit. Contact Buddy support for secure delivery.");
      const bytes = new Uint8Array(await data.arrayBuffer());
      let pageCount: number | undefined;
      if (file.filename.endsWith(".pdf")) {
        const pdf = await PDFDocument.load(bytes);
        if (!pdf.getPageCount()) throw new Error("empty PDF");
        pageCount = pdf.getPageCount();
      } else {
        const workbook = await JSZip.loadAsync(bytes, { checkCRC32: true });
        if (!workbook.file("[Content_Types].xml") || !workbook.file("xl/workbook.xml") ||
            !Object.keys(workbook.files).some(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))) throw new Error("invalid workbook");
      }
      add(file.filename, bytes, { category: "generated", kind: file.kind, pageCount, borrowerVisible: file.kind !== "credit_memo" });
    } catch (error) {
      if (error instanceof PackageArchiveError) throw error;
      throw new PackageArchiveError(`${file.label} could not be verified. Retry or prepare the package again.`);
    }
  }
  for (const [index, doc] of sources.entries()) {
    try {
      const bytes = await downloadDocumentBytes({ bucket: doc.storage_bucket || defaultDocumentBucket(), path: doc.storage_path });
      verifyDocumentContentIdentity({ bytes, expectedSizeBytes: doc.size_bytes, expectedSha256: doc.sha256 });
      // Flatten paths, remove control characters, and prefix an ordinal to prevent duplicate names.
      const safeName = (doc.original_filename || "document").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, "_").replace(/^\.+/, "").slice(0, 150) || "document";
      add(`Source-documents/${String(index + 1).padStart(3, "0")}-${safeName}`, bytes, {
        category: "source", borrowerVisible: ["borrower", "borrower_portal"].includes(doc.source), documentId: doc.id, documentType: doc.canonical_type || doc.document_type || null,
        years: [...new Set([...(doc.doc_years || []), doc.doc_year].filter((year): year is number => Number.isInteger(year)))],
        reviewStatus: !/FAILED|REJECTED|ERROR/i.test(doc.quality_status || "") &&
          (doc.finalized_at || ["AUTO_CONFIRMED", "USER_CONFIRMED"].includes(doc.intake_status || "")) ? "confirmed" : "review_required",
        identityStrength: doc.sha256 ? "sha256" : "size",
      });
    } catch (error) {
      if (error instanceof PackageArchiveError) throw error;
      throw new PackageArchiveError("A source document could not be verified. No partial package was released. Retry or resolve the upload.");
    }
  }
  zip.file("Package-inventory.json", JSON.stringify(inventory, null, 2), { date: ZIP_DATE });
  zip.file("Read-me.txt", `Prepared loan package\nRun: ${bundle.id}\nGenerated: ${bundle.generation_completed_at || "Unknown"}\n\nIncludes ${inventory.files.filter(file => file.category === "generated").length} generated documents and ${sources.length} source documents frozen for this run.\nSee Package-inventory.json for file sizes, integrity hashes and source review status. Uploaded evidence is not independent verification of its contents.\n\nPrepared for lender review, not credit approval. The lender confirms applicable requirements, signatures, business tax transcript requests and closing documents.\n`, { date: ZIP_DATE });
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  if (bytes.length > 50 * 1024 * 1024) throw new PackageArchiveError("This package exceeds the download size limit.");
  return { bytes, inventory, sha256: createHash("sha256").update(bytes).digest("hex") };
}
