import "server-only";

import { Storage } from "@google-cloud/storage";
import { buildGcsObjectKey, sanitizeFilename } from "@/lib/storage/gcsNaming";

const DEFAULT_SIGN_TTL_SECONDS = 15 * 60;

let cachedStorage: Storage | null = null;
let cachedCreds: Record<string, any> | null = null;

export function parseGcsServiceAccountJson(): {
  ok: true;
  credentials: Record<string, any>;
} | {
  ok: false;
  error: string;
} {
  const raw = process.env.GCS_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    return { ok: false, error: "GCS_SERVICE_ACCOUNT_JSON not set" };
  }

  const trimmed = raw.trim();

  const tryParse = (input: string) => {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  };

  const parsed = tryParse(trimmed) ?? tryParse(trimmed.replace(/\\n/g, "\n"));
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Invalid GCS_SERVICE_ACCOUNT_JSON" };
  }

  return { ok: true, credentials: parsed };
}

export function getGcsBucketName(): string {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    throw new Error("GCS_BUCKET not set");
  }
  return bucket;
}

function getGcsStorage(): Storage {
  if (cachedStorage) return cachedStorage;

  if (!cachedCreds) {
    const parsed = parseGcsServiceAccountJson();
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    cachedCreds = parsed.credentials;
  }

  cachedStorage = new Storage({
    credentials: cachedCreds,
    projectId: cachedCreds.project_id,
  });

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
