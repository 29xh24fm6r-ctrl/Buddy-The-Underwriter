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

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

export async function signUploadUrl(args: SignUploadArgs): Promise<SignUploadOk | SignUploadErr> {
  const requestId = `sign_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  try {
    const { bucket, objectPath } = args;

    console.log("[signUploadUrl] start", {
      requestId,
      bucket,
      objectPath,
      has_url: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
      has_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE),
    });

    if (!bucket) return { ok: false, requestId, error: "Missing bucket" };
    if (!objectPath) return { ok: false, requestId, error: "Missing objectPath" };

    const sb = supabaseAdmin();
    const bucketRef: any = sb.storage.from(bucket);

    // Prefer signed upload URLs (PUT direct-to-storage)
    if (typeof bucketRef.createSignedUploadUrl === "function") {
      const res: any = await withTimeout<any>(
        bucketRef.createSignedUploadUrl(objectPath),
        10_000,
        "createSignedUploadUrl",
      );
      const { data, error } = res ?? {};

      console.log("[signUploadUrl] createSignedUploadUrl result", {
        requestId,
        hasData: Boolean(data),
        error: error ? (error.message ?? String(error)) : null,
      });

      if (error) {
        console.error("[signUploadUrl] createSignedUploadUrl error", {
          requestId,
          bucket,
          objectPath,
          error,
        });
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
      const res: any = await withTimeout<any>(
        bucketRef.createSignedUrl(objectPath, exp),
        10_000,
        "createSignedUrl",
      );
      const { data, error } = res ?? {};

      console.log("[signUploadUrl] createSignedUrl result", {
        requestId,
        hasData: Boolean(data),
        error: error ? (error.message ?? String(error)) : null,
      });

      if (error) {
        console.error("[signUploadUrl] createSignedUrl error", {
          requestId,
          bucket,
          objectPath,
          error,
        });
        return {
          ok: false,
          requestId,
          error: "Failed to generate upload URL",
          detail: error.message ?? String(error),
        };
      }
      return { ok: true, requestId, bucket, objectPath, ...data };
    }

    console.error("[signUploadUrl] no signing method", { requestId, bucket, objectPath });
    return { ok: false, requestId, error: "No supported signing method on Supabase client" };
  } catch (e: any) {
    const isTimeout = String(e?.message || "").startsWith("timeout:");
    console.error("[signUploadUrl] fatal", {
      requestId,
      message: e?.message ?? String(e),
      stack: e?.stack,
      name: e?.name,
    });
    return {
      ok: false,
      requestId,
      error: isTimeout ? "Timeout generating upload URL" : "Internal error",
      detail: e?.message ?? String(e),
    };
  }
}
