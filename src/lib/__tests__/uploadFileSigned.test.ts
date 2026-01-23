import test from "node:test";
import assert from "node:assert/strict";
import { uploadFileWithSignedUrl } from "@/lib/uploads/uploadFile";

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
