import test from "node:test";
import assert from "node:assert/strict";
import { finalizeLegacyUpload } from "../finalizeLegacyUpload";
import { UploadCommitError } from "../uploadCommitError";

test("returns committed and never removes a successful upload", async () => {
  let removals = 0;
  const result = await finalizeLegacyUpload({
    commit: async () => ({ uploadId: "upload-1" }),
    removeUncommittedObject: async () => {
      removals += 1;
    },
  });

  assert.deepEqual(result, {
    status: "committed",
    commit: { uploadId: "upload-1" },
  });
  assert.equal(removals, 0);
});

test("keeps bytes when the upload audit row is already durable", async () => {
  let removals = 0;
  const result = await finalizeLegacyUpload({
    commit: async () => {
      throw new UploadCommitError("reconcile failed", true);
    },
    removeUncommittedObject: async () => {
      removals += 1;
    },
  });

  assert.deepEqual(result, {
    status: "processing_pending",
    error: "reconcile failed",
  });
  assert.equal(removals, 0);
});

test("removes only the current request object after a pre-commit failure", async () => {
  let removals = 0;
  const result = await finalizeLegacyUpload({
    commit: async () => {
      throw new UploadCommitError("audit insert failed", false);
    },
    removeUncommittedObject: async () => {
      removals += 1;
    },
  });

  assert.deepEqual(result, {
    status: "rolled_back",
    error: "audit insert failed",
  });
  assert.equal(removals, 1);
});

test("surfaces failed compensation for operational reconciliation", async () => {
  const result = await finalizeLegacyUpload({
    commit: async () => {
      throw new UploadCommitError("audit insert failed", false);
    },
    removeUncommittedObject: async () => {
      throw new Error("provider delete failed");
    },
  });

  assert.deepEqual(result, {
    status: "cleanup_failed",
    error: "audit insert failed",
    cleanupError: "provider delete failed",
  });
});

test("unknown failures preserve bytes instead of risking data loss", async () => {
  let removals = 0;
  const result = await finalizeLegacyUpload({
    commit: async () => {
      throw new Error("unexpected");
    },
    removeUncommittedObject: async () => {
      removals += 1;
    },
  });

  assert.deepEqual(result, {
    status: "processing_pending",
    error: "unexpected",
  });
  assert.equal(removals, 0);
});
