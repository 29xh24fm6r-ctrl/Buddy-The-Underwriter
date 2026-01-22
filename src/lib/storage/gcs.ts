import "server-only";

import { Storage, type StorageOptions } from "@google-cloud/storage";
import { buildGcsObjectKey, sanitizeFilename } from "@/lib/storage/gcsNaming";
import { getVercelWifAuthClient } from "@/lib/gcp/vercelAuth";

const DEFAULT_SIGN_TTL_SECONDS = 15 * 60;

let cachedStorage: Storage | null = null;

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

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

export async function getGcsClient(): Promise<Storage> {
  const projectId = getGcsProjectId() ?? undefined;

  console.log("[gcs-auth] runtime", {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    has: {
      GOOGLE_APPLICATION_CREDENTIALS: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      GCP_SERVICE_ACCOUNT_EMAIL: Boolean(process.env.GCP_SERVICE_ACCOUNT_EMAIL),
      GCP_WIF_PROVIDER: Boolean(process.env.GCP_WIF_PROVIDER),
      GCP_PROJECT_NUMBER: Boolean(process.env.GCP_PROJECT_NUMBER),
      GCP_WORKLOAD_IDENTITY_POOL_ID: Boolean(process.env.GCP_WORKLOAD_IDENTITY_POOL_ID),
      GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: Boolean(
        process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
      ),
      GCP_PROJECT_ID: Boolean(process.env.GCP_PROJECT_ID),
      GOOGLE_CLOUD_PROJECT: Boolean(process.env.GOOGLE_CLOUD_PROJECT),
      GCS_BUCKET: Boolean(process.env.GCS_BUCKET),
      GCS_UPLOADS_ENABLED: process.env.GCS_UPLOADS_ENABLED,
    },
  });
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log("[gcs-auth] branch=local-adc");
    return new Storage({ projectId });
  }

  if (isVercelRuntime()) {
    console.log("[gcs-auth] branch=vercel-wif");
    try {
      const authClient = await getVercelWifAuthClient();
      console.log("[gcs-auth] vercel-oidc-token=present", true);
      return new Storage({
        projectId,
        authClient: authClient as unknown as StorageOptions["authClient"],
      });
    } catch (e: any) {
      console.log("[gcs-auth] wif-auth-client-error", {
        name: e?.name,
        message: e?.message,
      });
      throw e;
    }
  }

  console.log("[gcs-auth] branch=missing-env");
  throw new Error(
    "Missing GCS credentials. Local: set GOOGLE_APPLICATION_CREDENTIALS. Vercel: set GCP_SERVICE_ACCOUNT_EMAIL and either GCP_WIF_PROVIDER or (GCP_PROJECT_NUMBER + GCP_WORKLOAD_IDENTITY_POOL_ID + GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID).",
  );
}

async function getGcsStorage(): Promise<Storage> {
  if (cachedStorage) return cachedStorage;

  cachedStorage = await getGcsClient();

  return cachedStorage;
}

export { buildGcsObjectKey, sanitizeFilename };

export async function signGcsUploadUrl(args: {
  key: string;
  contentType: string;
  expiresSeconds?: number;
}): Promise<string> {
  const storage = await getGcsStorage();
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
  const storage = await getGcsStorage();
  const bucket = getGcsBucketName();
  const expires = Date.now() + (args.expiresSeconds ?? DEFAULT_SIGN_TTL_SECONDS) * 1000;

  const [url] = await storage.bucket(bucket).file(args.key).getSignedUrl({
    version: "v4",
    action: "read",
    expires,
  });

  return url;
}
