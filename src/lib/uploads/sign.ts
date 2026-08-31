import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseSignedUploadEvidence } from "@/lib/uploads/signedUploadBoundary";

export type SignUploadArgs = {
  bucket: string;
  objectPath: string;
  expiresInSeconds?: number;
};

export type SignUploadOk = {
  ok: true;
  requestId: string;
  bucket: string;
  objectPath: string;
  signedUrl: string;
  token: string;
  path?: string;
};

export type SignUploadErr = {
  ok: false;
  requestId: string;
  error: string;
  detail?: string;
};

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function signUploadUrl(args: SignUploadArgs): Promise<SignUploadOk | SignUploadErr> {
  const requestId = `sign_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  try {
    const { bucket, objectPath } = args;
    if (!bucket) return { ok: false, requestId, error: "missing_bucket" };
    if (!objectPath) return { ok: false, requestId, error: "missing_object_path" };

    const bucketRef: any = supabaseAdmin().storage.from(bucket);
    if (typeof bucketRef.createSignedUploadUrl !== "function") {
      console.error("[signUploadUrl] signed upload unsupported", {
        requestId,
        provider: "supabase",
      });
      return { ok: false, requestId, error: "signed_upload_not_supported" };
    }

    const result: any = await withTimeout<any>(
      bucketRef.createSignedUploadUrl(objectPath),
      10_000,
      "createSignedUploadUrl",
    );
    const { data, error } = result ?? {};

    if (error) {
      console.error("[signUploadUrl] provider rejected signing", {
        requestId,
        provider: "supabase",
      });
      return { ok: false, requestId, error: "signed_upload_provider_failed" };
    }

    const evidence = parseSignedUploadEvidence(data);
    if (!evidence) {
      console.error("[signUploadUrl] invalid provider evidence", {
        requestId,
        provider: "supabase",
      });
      return { ok: false, requestId, error: "invalid_signed_upload_evidence" };
    }

    return {
      ok: true,
      requestId,
      bucket,
      objectPath,
      ...evidence,
    };
  } catch (error: unknown) {
    const timedOut =
      error instanceof Error &&
      error.message === "timeout:createSignedUploadUrl";
    console.error("[signUploadUrl] signing unavailable", {
      requestId,
      provider: "supabase",
      timedOut,
    });
    return {
      ok: false,
      requestId,
      error: timedOut ? "signed_upload_timeout" : "signed_upload_unavailable",
    };
  }
}
