export function buildGcsSignedUploadResponse(args: {
  bucket: string;
  key: string;
  signedUploadUrl: string;
  expiresSeconds: number;
  uploadSessionId?: string | null;
  uploadSessionExpiresAt?: string | null;
  /**
   * Extra headers (e.g. x-goog-content-length-range) that MUST be sent
   * verbatim on the storage PUT to match what was signed.
   */
  headers?: Record<string, string>;
}) {
  return {
    ok: true as const,
    deduped: false as const,
    bucket: args.bucket,
    key: args.key,
    signedUploadUrl: args.signedUploadUrl,
    expiresAt: new Date(Date.now() + args.expiresSeconds * 1000).toISOString(),
    upload_session_id: args.uploadSessionId ?? null,
    upload_session_expires_at: args.uploadSessionExpiresAt ?? null,
    headers: args.headers ?? null,
  };
}
