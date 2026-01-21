import "server-only";

type NormalizedGoogleError = {
  code: string;
  message: string;
  meta?: Record<string, unknown>;
};

function truncateMessage(message: string, max = 240) {
  if (message.length <= max) return message;
  return `${message.slice(0, max - 1)}…`;
}

function asString(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractStatus(error: any): number | null {
  const status = Number(error?.code ?? error?.status ?? error?.response?.status ?? NaN);
  return Number.isFinite(status) ? status : null;
}

function extractMessage(error: any): string {
  const msg =
    error?.message ||
    error?.details ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.response?.data ||
    "";
  return typeof msg === "string" ? msg : asString(msg);
}

export function normalizeGoogleError(error: unknown): NormalizedGoogleError {
  const err = error as any;
  const message = extractMessage(err) || asString(err) || "Unknown error";
  const status = extractStatus(err);
  const lower = message.toLowerCase();

  const meta: Record<string, unknown> = {
    status: status ?? null,
  };

  if (
    lower.includes("could not load the default credentials") ||
    lower.includes("default credentials") ||
    lower.includes("gcp_wif") ||
    lower.includes("workload identity") ||
    lower.includes("gcp_adc") ||
    lower.includes("no application default credentials")
  ) {
    return { code: "GOOGLE_AUTH_FAILED", message: truncateMessage(message), meta };
  }

  if (status === 403 && (lower.includes("storage") || lower.includes("gcs") || lower.includes("bucket"))) {
    return { code: "GCS_PERMISSION_DENIED", message: truncateMessage(message), meta };
  }

  if (status === 404 && (lower.includes("bucket") || lower.includes("object") || lower.includes("storage"))) {
    return { code: "GCS_NOT_FOUND", message: truncateMessage(message), meta };
  }

  if (status === 403 && (lower.includes("vertex") || lower.includes("gemini") || lower.includes("model"))) {
    return { code: "VERTEX_PERMISSION_DENIED", message: truncateMessage(message), meta };
  }

  if (status === 429 || lower.includes("quota") || lower.includes("resource_exhausted")) {
    return { code: "VERTEX_QUOTA", message: truncateMessage(message), meta };
  }

  if (status === 403) {
    return { code: "GOOGLE_PERMISSION_DENIED", message: truncateMessage(message), meta };
  }

  if (status === 404) {
    return { code: "GOOGLE_NOT_FOUND", message: truncateMessage(message), meta };
  }

  return { code: "GOOGLE_UNKNOWN", message: truncateMessage(message), meta };
}
