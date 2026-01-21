import "server-only";

import { Storage } from "@google-cloud/storage";
import { buildGcsObjectKey, sanitizeFilename } from "@/lib/storage/gcsNaming";
import { ensureGcpAdcBootstrap } from "@/lib/gcpAdcBootstrap";

const DEFAULT_SIGN_TTL_SECONDS = 15 * 60;

let cachedStorage: Storage | null = null;

ensureGcpAdcBootstrap();

export function getGcsBucketName(): string {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    throw new Error("GCS_BUCKET not set");
  }
  return bucket;
}

function getGcsProjectId(): string | null {
  return (
    process.env.GCS_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    null
  );
}

export function getGcsClient(): Storage {
  return new Storage({
    projectId: getGcsProjectId() ?? undefined,
  });
}

function getGcsStorage(): Storage {
  if (cachedStorage) return cachedStorage;

  ensureGcpAdcBootstrap();

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "Missing GCS credentials. Configure GCP_WIF_PROVIDER + GCP_SERVICE_ACCOUNT_EMAIL + VERCEL_OIDC_TOKEN (Vercel) or GOOGLE_APPLICATION_CREDENTIALS (local).",
    );
  }

  cachedStorage = getGcsClient();

  return cachedStorage;
}

export { buildGcsObjectKey, sanitizeFilename };

export async function signGcsUploadUrl(args: {
  key: string;
  contentType: string;
  expiresSeconds?: number;
}): Promise<string> {
  const storage = getGcsStorage();
  const bucket = getGcsBucketName();
  const expires = Date.now() + (args.expiresSeconds ?? DEFAULT_SIGN_TTL_SECONDS) * 1000;

  const [url] = await storage.bucket(bucket).file(args.key).getSignedUrl({
    version: "v4",
    action: "write",
    expires,
    contentType: args.contentType,
  });

  return url;
}

export async function signGcsReadUrl(args: {
  key: string;
  expiresSeconds?: number;
}): Promise<string> {
  const storage = getGcsStorage();
  const bucket = getGcsBucketName();
  const expires = Date.now() + (args.expiresSeconds ?? DEFAULT_SIGN_TTL_SECONDS) * 1000;

  const [url] = await storage.bucket(bucket).file(args.key).getSignedUrl({
    version: "v4",
    action: "read",
    expires,
  });

  return url;
}
