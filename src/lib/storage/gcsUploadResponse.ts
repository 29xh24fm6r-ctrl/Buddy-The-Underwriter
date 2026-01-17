export function buildGcsSignedUploadResponse(args: {
  bucket: string;
  key: string;
  signedUploadUrl: string;
  expiresSeconds: number;
}) {
  return {
    ok: true as const,
    deduped: false as const,
    bucket: args.bucket,
    key: args.key,
    signedUploadUrl: args.signedUploadUrl,
    expiresAt: new Date(Date.now() + args.expiresSeconds * 1000).toISOString(),
  };
}
