import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { defaultDocumentBucket } from "@/lib/storage/documentBytes";
import {
  DOCUMENT_DOWNLOAD_TTL_SECONDS,
  proveCanonicalDocumentDownload,
  type CanonicalDownloadDocument,
} from "@/lib/storage/documentDownloadDelivery";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STORAGE_PATH_LENGTH = 1_024;
const MAX_BUCKET_LENGTH = 128;

type DownloadFailure = {
  ok: false;
  status: 400 | 404 | 503;
  error:
    | "invalid_request"
    | "document_not_found"
    | "document_state_unavailable"
    | "document_integrity_unavailable"
    | "download_unavailable"
    | "download_audit_unavailable";
};

type DownloadSuccess = {
  ok: true;
  signedUrl: string;
  expiresInSeconds: number;
  identity: {
    sizeBytes: number;
    sha256: string;
    strength: "sha256" | "size";
  };
};

export type AuthorizedDocumentDownloadResult = DownloadFailure | DownloadSuccess;

export async function withDocumentDownloadTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("document_download_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isValidDocumentDownloadId(value: string): boolean {
  return UUID_RE.test(value);
}

export function isValidStoredDocumentCoordinate(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

export async function createAuthorizedDocumentDownload(args: {
  dealId: string;
  bankId: string;
  documentId?: string | null;
  storagePath?: string | null;
}): Promise<AuthorizedDocumentDownloadResult> {
  const dealId = String(args.dealId || "").trim();
  const bankId = String(args.bankId || "").trim();
  const documentId = String(args.documentId || "").trim();
  const requestedPath = String(args.storagePath || "").trim();

  if (
    !isValidDocumentDownloadId(dealId) ||
    !isValidDocumentDownloadId(bankId) ||
    (documentId && !isValidDocumentDownloadId(documentId)) ||
    (requestedPath && !isValidStoredDocumentCoordinate(requestedPath, MAX_STORAGE_PATH_LENGTH)) ||
    Number(Boolean(documentId)) + Number(Boolean(requestedPath)) !== 1
  ) {
    return { ok: false, status: 400, error: "invalid_request" };
  }

  const sb = supabaseAdmin();
  let query = sb
    .from("deal_documents")
    .select("id, deal_id, bank_id, storage_bucket, storage_path, size_bytes, sha256")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  query = documentId ? query.eq("id", documentId) : query.eq("storage_path", requestedPath);
  const readResult = await withDocumentDownloadTimeout(query.maybeSingle(), 8_000).catch(
    () => null,
  );
  if (!readResult) {
    return { ok: false, status: 503, error: "document_state_unavailable" };
  }
  const { data: doc, error: readError } = readResult;
  if (readError) {
    return { ok: false, status: 503, error: "document_state_unavailable" };
  }
  if (!doc) {
    return { ok: false, status: 404, error: "document_not_found" };
  }

  const storageBucket = String(doc.storage_bucket || defaultDocumentBucket()).trim();
  const storagePath = String(doc.storage_path || "").trim();
  if (
    !isValidStoredDocumentCoordinate(storageBucket, MAX_BUCKET_LENGTH) ||
    !isValidStoredDocumentCoordinate(storagePath, MAX_STORAGE_PATH_LENGTH)
  ) {
    return { ok: false, status: 503, error: "document_state_unavailable" };
  }

  // SPEC-SEC / #996 composition: never hand out a provider URL for bytes we have
  // not proven. proveCanonicalDocumentDownload downloads the object, verifies it
  // against the stored size_bytes (and sha256 where persisted), and only then
  // signs — at DOCUMENT_DOWNLOAD_TTL_SECONDS, the shorter of the two TTLs the
  // merged branches used. Validation, tenant scoping, timeouts and the
  // fail-closed audit below remain this module's responsibility.
  let proven;
  try {
    proven = await withDocumentDownloadTimeout(
      proveCanonicalDocumentDownload({
        id: String(doc.id),
        deal_id: String(doc.deal_id),
        bank_id: bankId,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        size_bytes: (doc as { size_bytes?: number | null }).size_bytes ?? null,
        sha256: (doc as { sha256?: string | null }).sha256 ?? null,
      } satisfies CanonicalDownloadDocument),
      35_000,
    );
  } catch {
    return { ok: false, status: 503, error: "document_integrity_unavailable" };
  }

  const signedUrl = proven.signedUrl;
  if (!/^https:\/\//i.test(signedUrl) || signedUrl.length > 8_192) {
    return { ok: false, status: 503, error: "download_unavailable" };
  }

  let audit;
  try {
    audit = await withDocumentDownloadTimeout(
      sb
        .from("deal_pipeline_ledger")
        .insert({
          deal_id: dealId,
          bank_id: bankId,
          event_key: "documents.download_signed",
          stage: "documents.download_signed",
          status: "ok",
          ui_state: "done",
          ui_message: "Document download authorized",
          meta: {
            size_bytes: proven.sizeBytes,
            sha256: proven.sha256,
            identity_strength: proven.identityStrength,
            expires_in_seconds: DOCUMENT_DOWNLOAD_TTL_SECONDS,
          },
          provider_metrics: null,
        } as any)
        .select("id, deal_id, bank_id, event_key, status")
        .single(),
      8_000,
    );
  } catch {
    return { ok: false, status: 503, error: "download_audit_unavailable" };
  }
  if (
    audit.error ||
    !audit.data?.id ||
    audit.data.deal_id !== dealId ||
    audit.data.bank_id !== bankId ||
    audit.data.event_key !== "documents.download_signed" ||
    audit.data.status !== "ok"
  ) {
    return { ok: false, status: 503, error: "download_audit_unavailable" };
  }

  return {
    ok: true,
    signedUrl,
    expiresInSeconds: DOCUMENT_DOWNLOAD_TTL_SECONDS,
    identity: {
      sizeBytes: proven.sizeBytes,
      sha256: proven.sha256,
      strength: proven.identityStrength,
    },
  };
}
