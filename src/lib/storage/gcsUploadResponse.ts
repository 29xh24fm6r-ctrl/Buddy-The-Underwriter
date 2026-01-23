export function buildGcsSignedUploadResponse(args: {
  bucket: string;
  key: string;
  signedUploadUrl: string;
  expiresSeconds: number;
  uploadSessionId?: string | null;
  uploadSessionExpiresAt?: string | null;
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
  };
}
