const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

export const MAX_PORTAL_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_PORTAL_UPLOAD_JSON_BYTES = 8 * 1024;

export class PortalUploadBoundaryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "PortalUploadBoundaryError";
  }
}

function requiredString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") {
    throw new PortalUploadBoundaryError(`invalid_${name}`, 400);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new PortalUploadBoundaryError(`invalid_${name}`, 400);
  }
  return trimmed;
}

function optionalString(value: unknown, name: string, max: number): string | null {
  if (value == null || value === "") return null;
  return requiredString(value, name, max);
}

function optionalUuid(value: unknown, name: string): string | null {
  const parsed = optionalString(value, name, 36);
  if (parsed && !UUID.test(parsed)) {
    throw new PortalUploadBoundaryError(`invalid_${name}`, 400);
  }
  return parsed;
}

function requiredUuid(value: unknown, name: string): string {
  const parsed = optionalUuid(value, name);
  if (!parsed) throw new PortalUploadBoundaryError(`invalid_${name}`, 400);
  return parsed;
}

function uploadSize(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new PortalUploadBoundaryError("invalid_size_bytes", 400);
  }
  if (Number(value) > MAX_PORTAL_UPLOAD_BYTES) {
    throw new PortalUploadBoundaryError("upload_too_large", 413);
  }
  return Number(value);
}

function mimeType(value: unknown): string {
  if (value == null || value === "") return "application/octet-stream";
  const parsed = requiredString(value, "mime_type", 255).toLowerCase();
  if (!MIME.test(parsed)) {
    throw new PortalUploadBoundaryError("invalid_mime_type", 400);
  }
  return parsed;
}

export type PortalUploadPrepareRequest = {
  token: string;
  requestId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export function parsePortalUploadPrepareRequest(body: unknown): PortalUploadPrepareRequest {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    token: requiredString(input.token, "token", 512),
    requestId: optionalUuid(input.requestId, "request_id"),
    filename: requiredString(input.filename, "filename", 255),
    mimeType: mimeType(input.mimeType),
    sizeBytes: uploadSize(input.sizeBytes),
  };
}

export type PortalUploadCommitRequest = PortalUploadPrepareRequest & {
  uploadSessionId: string;
  fileId: string;
  path: string;
  taskKey: string | null;
  spreadReviewActionId: string | null;
  spreadFindingKey: string | null;
  draftBorrowerRequestId: string | null;
  requestedEvidenceKind: string | null;
};

export function parsePortalUploadCommitRequest(
  body: unknown,
  headerSessionId: string | null,
): PortalUploadCommitRequest {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const base = parsePortalUploadPrepareRequest(input);
  const sessionValue =
    headerSessionId ?? input.uploadSessionId ?? input.upload_session_id ?? input.session_id;
  const fileValue = input.fileId ?? input.file_id;
  return {
    ...base,
    uploadSessionId: requiredUuid(sessionValue, "upload_session_id"),
    fileId: requiredUuid(fileValue, "file_id"),
    path: requiredString(input.path, "path", 1024),
    taskKey: optionalString(input.taskKey, "task_key", 160),
    spreadReviewActionId: optionalUuid(input.spreadReviewActionId, "spread_review_action_id"),
    spreadFindingKey: optionalString(input.spreadFindingKey, "spread_finding_key", 160),
    draftBorrowerRequestId: optionalUuid(input.draftBorrowerRequestId, "draft_borrower_request_id"),
    requestedEvidenceKind: optionalString(input.requestedEvidenceKind, "requested_evidence_kind", 160),
  };
}

export type PreparedPortalUpload = {
  session_id: unknown;
  deal_id: unknown;
  bank_id: unknown;
  file_id: unknown;
  filename: unknown;
  content_type: unknown;
  size_bytes: unknown;
  object_key: unknown;
  bucket: unknown;
  status: unknown;
};

export function assertPreparedPortalUpload(args: {
  prepared: PreparedPortalUpload;
  request: PortalUploadCommitRequest;
  dealId: string;
  bankId: string;
}): {
  bucket: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "ready" | "completed";
} {
  const { prepared, request } = args;
  const exact =
    String(prepared.session_id) === request.uploadSessionId &&
    String(prepared.deal_id) === args.dealId &&
    String(prepared.bank_id) === args.bankId &&
    String(prepared.file_id) === request.fileId &&
    String(prepared.object_key) === request.path &&
    String(prepared.filename) === request.filename &&
    String(prepared.content_type).toLowerCase() === request.mimeType &&
    Number(prepared.size_bytes) === request.sizeBytes;

  if (!exact) {
    throw new PortalUploadBoundaryError("upload_session_file_mismatch", 409);
  }

  const bucket = requiredString(prepared.bucket, "prepared_bucket", 255);
  const status = String(prepared.status);
  if (status !== "ready" && status !== "completed") {
    throw new PortalUploadBoundaryError("upload_session_file_unavailable", 409);
  }

  return {
    bucket,
    path: request.path,
    filename: request.filename,
    mimeType: request.mimeType,
    sizeBytes: request.sizeBytes,
    status,
  };
}

export function assertBoundedJsonContentLength(value: string | null): void {
  if (!value) return;
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new PortalUploadBoundaryError("invalid_content_length", 400);
  }
  if (length > MAX_PORTAL_UPLOAD_JSON_BYTES) {
    throw new PortalUploadBoundaryError("request_too_large", 413);
  }
}
