import "server-only";

import { Storage } from "@google-cloud/storage";

/**
 * Create a V4 signed PUT URL using the official GCS library.
 * Auth resolves implicitly via environment / runtime (ADC, GOOGLE_APPLICATION_CREDENTIALS, etc.).
 */
export async function createGcsV4SignedPutUrl(opts: {
  bucket: string;
  objectKey: string;
  contentType: string;
  expiresSeconds: number;
}): Promise<{ url: string; headers: Record<string, string> }> {
  const { bucket, objectKey, contentType, expiresSeconds } = opts;

  const storage = new Storage();

  const file = storage.bucket(bucket).file(objectKey);

  const expires = Date.now() + Math.max(1, expiresSeconds) * 1000;

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires,
    contentType,
  });

  // The uploader MUST send the same Content-Type used when signing.
  return { url, headers: { "Content-Type": contentType } };
}
