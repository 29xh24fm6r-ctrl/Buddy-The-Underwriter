export type UploadSessionFileInput = {
  name: string;
  size: number;
  mime?: string | null;
};

export type CreateUploadSessionInput = {
  dealId?: string | null;
  dealName?: string | null;
  dealMode?: "quick_look" | "full_underwrite" | null;
  source: "banker" | "borrower";
  files: UploadSessionFileInput[];
  portalToken?: string | null;
  portalLinkId?: string | null;
  createdByName?: string | null;
  createdByEmail?: string | null;
};

export type UploadSessionResponse = {
  ok: boolean;
  dealId?: string;
  sessionId?: string;
  displayName?: string | null;
  uploadUrls?: Array<{
    fileId: string;
    signedUrl: string;
    method: "PUT";
    headers: Record<string, string>;
    objectKey: string;
    bucket: string;
    filename: string;
    sizeBytes: number;
  }>;
  uploadSessionExpiresAt?: string | null;
  redirectUrl?: string;
  requestId?: string;
  error?: string;
  /** Structured error code (e.g. WIF_AUDIENCE_INVALID) */
  code?: string;
  /** Human-readable error message */
  message?: string;
};

export async function createUploadSession(
  input: CreateUploadSessionInput,
  timeoutMs = 20000,
): Promise<UploadSessionResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("/api/uploads/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    const payload = (await res.json().catch(() => null)) as UploadSessionResponse | null;
    if (!res.ok) {
      return payload || { ok: false, error: `HTTP_${res.status}` };
    }

    return payload || { ok: false, error: "invalid_response" };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "upload_session_timeout", message: "Upload session timed out. Please retry." };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
