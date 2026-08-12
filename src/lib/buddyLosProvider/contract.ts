import { createHash, timingSafeEqual } from "node:crypto";

export const CONTRACT_VERSION = "buddy-document-intelligence.v1" as const;
export const ENGINE_VERSION = "buddy-underwriter-document-intelligence.v1";
export const DEFAULT_PROVIDER_NAME = "buddy-underwriter";
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/webp",
]);

export type ProviderRequest = {
  contractVersion: typeof CONTRACT_VERSION;
  jobId: string;
  organizationId: string;
  dealId: string;
  documentId: string;
  documentVersionId: string;
  sha256: string;
  mediaType: string;
};

export type EvidenceReference = {
  documentId: string;
  documentVersionId: string;
  sha256: string;
  page: number | null;
  locator: string | null;
};

export type ProviderConfig = {
  apiKey: string;
  providerName: string;
  entitledOrganizationIds: ReadonlySet<string>;
};

export type ProviderAdmission =
  | { enabled: false; reason: "not_provider_deployment" | "disabled" | "invalid_configuration" }
  | { enabled: true; config: ProviderConfig };

export function readProviderAdmission(
  env: Record<string, string | undefined> = process.env,
): ProviderAdmission {
  if (env.BUDDY_LOS_PROVIDER_ONLY !== "true") {
    return { enabled: false, reason: "not_provider_deployment" };
  }
  if (env.BUDDY_LOS_PROVIDER_ENABLED !== "true") {
    return { enabled: false, reason: "disabled" };
  }

  const apiKey = env.BUDDY_LOS_PROVIDER_API_KEY?.trim() ?? "";
  const providerName = env.BUDDY_LOS_PROVIDER_NAME?.trim() || DEFAULT_PROVIDER_NAME;
  const entitledOrganizationIds = new Set(
    (env.BUDDY_LOS_PROVIDER_ORGANIZATION_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (
    apiKey.length < 32 ||
    apiKey.length > 256 ||
    !/^[a-z0-9][a-z0-9._-]{1,119}$/i.test(providerName) ||
    entitledOrganizationIds.size === 0
  ) {
    return { enabled: false, reason: "invalid_configuration" };
  }

  return { enabled: true, config: { apiKey, providerName, entitledOrganizationIds } };
}

export function bearerMatches(header: string | null, expectedKey: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(expectedKey, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseProviderRequest(raw: string): ProviderRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("invalid_request_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_request");
  const request = value as Record<string, unknown>;
  const required = ["jobId", "organizationId", "dealId", "documentId", "documentVersionId"] as const;
  for (const field of required) {
    if (typeof request[field] !== "string" || request[field].length < 1 || request[field].length > 200) {
      throw new Error(`invalid_${field}`);
    }
  }
  if (request.contractVersion !== CONTRACT_VERSION) throw new Error("unsupported_contract_version");
  if (typeof request.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(request.sha256)) throw new Error("invalid_sha256");
  if (typeof request.mediaType !== "string") throw new Error("invalid_media_type");
  const mediaType = normalizeMediaType(request.mediaType);
  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) throw new Error("unsupported_media_type");

  return { ...(request as ProviderRequest), sha256: request.sha256.toLowerCase(), mediaType };
}

export function validateSubmission(input: {
  request: ProviderRequest;
  idempotencyKey: string | null;
  fileMediaType: string;
  fileSize: number;
  entitledOrganizationIds: ReadonlySet<string>;
}): void {
  const { request } = input;
  if (!input.entitledOrganizationIds.has(request.organizationId)) throw new Error("organization_not_entitled");
  if (input.idempotencyKey !== `${request.jobId}:${request.documentVersionId}`) throw new Error("invalid_idempotency_key");
  if (input.fileSize < 1 || input.fileSize > MAX_DOCUMENT_BYTES) throw new Error("invalid_document_size");
  if (normalizeMediaType(input.fileMediaType) !== request.mediaType) throw new Error("media_type_mismatch");
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function evidenceFor(
  request: ProviderRequest,
  locator: string | null,
  page: number | null = null,
): EvidenceReference {
  return {
    documentId: request.documentId,
    documentVersionId: request.documentVersionId,
    sha256: request.sha256,
    page,
    locator: locator ? locator.slice(0, 500) : null,
  };
}

function normalizeMediaType(value: string): string {
  const normalized = value.toLowerCase().split(";", 1)[0]!.trim();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}
