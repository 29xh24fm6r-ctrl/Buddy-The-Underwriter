export type UploadSessionFileInput = {
  name: string;
  size: number;
  mime?: string | null;
};

export type CreateUploadSessionInput = {
  dealId?: string | null;
  dealName?: string | null;
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
};

export async function createUploadSession(
  input: CreateUploadSessionInput,
): Promise<UploadSessionResponse> {
  const res = await fetch("/api/uploads/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = (await res.json().catch(() => null)) as UploadSessionResponse | null;
  if (!res.ok) {
    return payload || { ok: false, error: `HTTP_${res.status}` };
  }

  return payload || { ok: false, error: "invalid_response" };
}
