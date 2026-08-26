import "server-only";

import { getGcsClient } from "@/lib/storage/gcs";

/**
 * Create a V4 signed PUT URL using Buddy's canonical GCS client.
 *
 * Vercel production authenticates to GCS through Workload Identity Federation,
 * so every signing path must use getGcsClient(). Constructing a bare Storage
 * client here only supports ambient ADC and strands Vercel uploads with
 * "Unable to find credentials in current environment".
 */
export async function createGcsV4SignedPutUrl(opts: {
  bucket: string;
  objectKey: string;
  contentType: string;
  expiresSeconds: number;
  /**
   * When provided, adds an X-Goog-Content-Length-Range extension header
   * condition to the V4 signature so GCS itself rejects a PUT whose body
   * exceeds this size, instead of relying solely on the client-declared
   * size checked at sign time. The returned `headers` includes the matching
   * header — the uploader MUST send it verbatim on the PUT.
   */
  maxSizeBytes?: number;
}): Promise<{ url: string; headers: Record<string, string> }> {
  const { bucket, objectKey, contentType, expiresSeconds, maxSizeBytes } = opts;

  const storage = await getGcsClient();
  const file = storage.bucket(bucket).file(objectKey);

  const expires = Date.now() + Math.max(1, expiresSeconds) * 1000;

  const contentLengthRange = maxSizeBytes != null ? `0,${maxSizeBytes}` : null;
  const extensionHeaders = contentLengthRange
    ? { "x-goog-content-length-range": contentLengthRange }
    : undefined;

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires,
    contentType,
    ...(extensionHeaders ? { extensionHeaders } : {}),
  });

  // The uploader MUST send the same headers used when signing.
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (contentLengthRange) headers["x-goog-content-length-range"] = contentLengthRange;

  return { url, headers };
}
