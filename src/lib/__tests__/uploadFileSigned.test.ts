import test from "node:test";
import assert from "node:assert/strict";
import { uploadFileWithSignedUrl } from "@/lib/uploads/uploadFile";

/**
 * Minimal XHR stand-in: `uploadViaSignedUrl` only uses open/setRequestHeader/
 * send plus the load/error/timeout listeners, so a fake that fires one of
 * those is enough to pin the failure classification.
 */
function installFakeXhr(outcome: { event: "load" | "error" | "timeout"; status?: number }) {
  const listeners = new Map<string, Array<() => void>>();

  class FakeXhr {
    status = outcome.status ?? 0;
    statusText = "";
    timeout = 0;
    upload = { addEventListener() {} };
    addEventListener(type: string, fn: () => void) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(fn);
      listeners.set(type, bucket);
    }
    open() {}
    setRequestHeader() {}
    send() {
      queueMicrotask(() => {
        for (const fn of listeners.get(outcome.event) ?? []) fn();
      });
    }
  }

  const previous = (globalThis as any).XMLHttpRequest;
  (globalThis as any).XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  return () => {
    (globalThis as any).XMLHttpRequest = previous;
  };
}

const FILE = { type: "application/pdf" } as File;

test("uploadFileWithSignedUrl enforces invariant in new-deal context", async () => {
  await assert.rejects(
    () =>
      uploadFileWithSignedUrl({
        uploadUrl: "",
        headers: {},
        file: {} as File,
        context: "new-deal",
      }),
    (err: any) => String(err?.message || "").includes("invariant_violation_missing_signed_url"),
  );
});

/**
 * A blocked CORS preflight (the bucket-allowlist outage) reaches XHR as an
 * error event with status 0. The session is untouched, so the banker must not
 * be told to restart deal creation.
 */
test("a PUT blocked before storage reports transport failure, not session expiry", async () => {
  const restore = installFakeXhr({ event: "error" });
  try {
    await assert.rejects(
      () =>
        uploadFileWithSignedUrl({
          uploadUrl: "https://storage.googleapis.com/bucket/obj",
          headers: {},
          file: FILE,
          context: "new-deal",
        }),
      (err: any) => {
        assert.equal(err.message, "upload_transport_blocked");
        assert.equal(err.code, "NETWORK_ERROR");
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("a client-side timeout is also transport failure, not session expiry", async () => {
  const restore = installFakeXhr({ event: "timeout" });
  try {
    await assert.rejects(
      () =>
        uploadFileWithSignedUrl({
          uploadUrl: "https://storage.googleapis.com/bucket/obj",
          headers: {},
          file: FILE,
          context: "new-deal",
        }),
      (err: any) => err.message === "upload_transport_blocked" && err.code === "UPLOAD_TIMEOUT",
    );
  } finally {
    restore();
  }
});

/** A real HTTP status means storage rejected the signature — restart is right. */
test("a 403 from storage still reports an expired upload session", async () => {
  const restore = installFakeXhr({ event: "load", status: 403 });
  try {
    await assert.rejects(
      () =>
        uploadFileWithSignedUrl({
          uploadUrl: "https://storage.googleapis.com/bucket/obj",
          headers: {},
          file: FILE,
          context: "new-deal",
        }),
      (err: any) => err.message === "upload_session_expired_restart" && err.code === "HTTP_403",
    );
  } finally {
    restore();
  }
});

test("existing-deal context returns the failure instead of throwing", async () => {
  const restore = installFakeXhr({ event: "error" });
  try {
    const result = await uploadFileWithSignedUrl({
      uploadUrl: "https://storage.googleapis.com/bucket/obj",
      headers: {},
      file: FILE,
      context: "existing-deal",
      maxAttempts: 1,
    });
    assert.equal(result.ok, false);
    assert.equal((result as any).code, "NETWORK_ERROR");
  } finally {
    restore();
  }
});
