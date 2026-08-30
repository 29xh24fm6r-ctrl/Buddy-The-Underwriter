import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEventRequired } from "@/lib/pipeline/logLedgerEvent";
import { defaultDocumentBucket, isGcsBucket } from "@/lib/storage/documentBytes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STORAGE_PATH_LENGTH = 1_024;
const MAX_BUCKET_LENGTH = 128;

type DownloadFailure = {
  ok: false;
  status: 400 | 404 | 503;
  error: "invalid_request" | "document_not_found" | "document_state_unavailable" | "download_unavailable" | "download_audit_unavailable";
};

type DownloadSuccess = {
  ok: true;
  signedUrl: string;
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
    .select("id, deal_id, bank_id, storage_bucket, storage_path")
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

  let signedUrl = "";
  let provider: "gcs" | "supabase" = "supabase";
  try {
    if (isGcsBucket(storageBucket)) {
      provider = "gcs";
      const { signGcsReadUrl } = await import("@/lib/storage/gcs");
      signedUrl = await withDocumentDownloadTimeout(
        signGcsReadUrl({ key: storagePath, expiresSeconds: 300 }),
        12_000,
      );
    } else {
      const { data, error } = await withDocumentDownloadTimeout(
        sb.storage.from(storageBucket).createSignedUrl(storagePath, 300),
        12_000,
      );
      if (error || !data?.signedUrl) {
        return { ok: false, status: 503, error: "download_unavailable" };
      }
      signedUrl = data.signedUrl;
    }
  } catch {
    return { ok: false, status: 503, error: "download_unavailable" };
  }

  if (!/^https:\/\//i.test(signedUrl) || signedUrl.length > 8_192) {
    return { ok: false, status: 503, error: "download_unavailable" };
  }

  let audit;
  try {
    audit = await withDocumentDownloadTimeout(
      logLedgerEventRequired({
        dealId,
        bankId,
        eventKey: "documents.download_signed",
        uiState: "done",
        uiMessage: "Document download authorized",
        meta: { provider },
      }),
      8_000,
    );
  } catch {
    return { ok: false, status: 503, error: "download_audit_unavailable" };
  }
  if (!audit.ok) {
    return { ok: false, status: 503, error: "download_audit_unavailable" };
  }

  return { ok: true, signedUrl };
}
