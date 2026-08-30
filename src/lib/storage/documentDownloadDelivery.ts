import "server-only";

import {
  createDocumentDownloadUrl,
  defaultDocumentBucket,
  downloadDocumentBytes,
  verifyDocumentContentIdentity,
} from "@/lib/storage/documentBytes";

export const DOCUMENT_DOWNLOAD_TTL_SECONDS = 60;

export type CanonicalDownloadDocument = {
  id: string;
  deal_id: string;
  bank_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  size_bytes?: number | null;
  sha256?: string | null;
};

export type ProvenDocumentDownload = {
  signedUrl: string;
  bucket: string;
  path: string;
  sizeBytes: number;
  sha256: string;
  identityStrength: "sha256" | "size";
};

/**
 * Prove the bytes behind a canonical deal_documents row before releasing a
 * provider URL. Canonical upload paths are create-once, so the verified object
 * cannot be replaced through Buddy's upload surfaces after this check.
 *
 * Historic rows may predate sha256 persistence. They still require exact stored
 * size proof; current rows require both size and digest proof.
 */
export async function proveCanonicalDocumentDownload(
  document: CanonicalDownloadDocument,
): Promise<ProvenDocumentDownload> {
  const bucket = String(document.storage_bucket || defaultDocumentBucket()).trim();
  const path = String(document.storage_path || "").trim();
  const hasStoredSize = document.size_bytes !== null && document.size_bytes !== undefined;
  const expectedSizeBytes = hasStoredSize ? Number(document.size_bytes) : Number.NaN;
  const expectedSha256 = String(document.sha256 || "").trim().toLowerCase();

  if (!document.id || !document.deal_id || !bucket || !path) {
    throw new Error("document_identity_unavailable");
  }
  if (!hasStoredSize || !Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 0) {
    throw new Error("document_identity_unavailable");
  }
  if (expectedSha256 && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("document_identity_unavailable");
  }

  const bytes = await downloadDocumentBytes({ bucket, path });
  let identity;
  try {
    identity = verifyDocumentContentIdentity({
      bytes,
      expectedSizeBytes,
      expectedSha256: expectedSha256 || null,
    });
  } catch {
    throw new Error("document_integrity_check_failed");
  }

  const signedUrl = await createDocumentDownloadUrl({
    bucket,
    path,
    expiresInSeconds: DOCUMENT_DOWNLOAD_TTL_SECONDS,
  });

  return {
    signedUrl,
    bucket,
    path,
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
    identityStrength: expectedSha256 ? "sha256" : "size",
  };
}
