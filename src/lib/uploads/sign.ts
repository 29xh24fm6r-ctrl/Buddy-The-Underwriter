import { supabaseAdmin } from "@/lib/supabase/admin";

export type SignUploadArgs = {
  bucket: string;
  objectPath: string;
  expiresInSeconds?: number; // used for fallback signedUrl
};

export type SignUploadOk = {
  ok: true;
  requestId: string;
  bucket: string;
  objectPath: string;
  // createSignedUploadUrl returns: { signedUrl, path, token? } depending on SDK version
  signedUrl?: string;
  path?: string;
  token?: string;
  // createSignedUrl returns: { signedUrl }
};

export type SignUploadErr = {
  ok: false;
  requestId: string;
  error: string;
  detail?: string;
};

export async function signUploadUrl(args: SignUploadArgs): Promise<SignUploadOk | SignUploadErr> {
  const requestId = `sign_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  try {
    const { bucket, objectPath } = args;
    if (!bucket) return { ok: false, requestId, error: "Missing bucket" };
    if (!objectPath) return { ok: false, requestId, error: "Missing objectPath" };

    const sb = supabaseAdmin();
    const bucketRef: any = sb.storage.from(bucket);

    // Prefer signed upload URLs (PUT direct-to-storage)
    if (typeof bucketRef.createSignedUploadUrl === "function") {
      const { data, error } = await bucketRef.createSignedUploadUrl(objectPath);
      if (error) {
        console.error("[signUploadUrl] createSignedUploadUrl error", { requestId, bucket, objectPath, error });
        return {
          ok: false,
          requestId,
          error: "Failed to generate upload URL",
          detail: error.message ?? String(error),
        };
      }
      return {
        ok: true,
        requestId,
        bucket,
        objectPath,
        ...data,
      };
    }

    // Fallback: signed URL (time-limited)
    if (typeof bucketRef.createSignedUrl === "function") {
      const exp = args.expiresInSeconds ?? 60 * 5;
      const { data, error } = await bucketRef.createSignedUrl(objectPath, exp);
      if (error) {
        console.error("[signUploadUrl] createSignedUrl error", { requestId, bucket, objectPath, error });
        return {
          ok: false,
          requestId,
          error: "Failed to generate upload URL",
          detail: error.message ?? String(error),
        };
      }
      return { ok: true, requestId, bucket, objectPath, ...data };
    }

    console.error("[signUploadUrl] No signing method available", { requestId, bucket, objectPath });
    return { ok: false, requestId, error: "No supported signing method on Supabase client" };
  } catch (e: any) {
    console.error("[signUploadUrl] fatal", { requestId, error: e?.message ?? String(e), stack: e?.stack });
    return { ok: false, requestId, error: "Internal error", detail: e?.message ?? String(e) };
  }
}
