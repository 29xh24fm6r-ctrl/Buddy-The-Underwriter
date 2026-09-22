import test from "node:test";
import assert from "node:assert/strict";
import { reconcileCompletedUpload } from "../PortalUploadDropzone";

function fixture(name: string, size: number, lastModified: number) {
  return { name, size, lastModified } as File;
}

test("successful retry removes stale failures for the exact same file", () => {
  const file = fixture("return.pdf", 2709, 123);
  const uploads: any[] = [
    { id: "old", file, name: file.name, status: "error", error: "temporary", pct: 0 },
    { id: "retry", file, name: file.name, status: "uploading", pct: 80 },
  ];
  const result = reconcileCompletedUpload(uploads, "retry", { ok: true });
  assert.deepEqual(result.map((upload) => [upload.id, upload.status, upload.pct]), [["retry", "success", 100]]);
});

test("success does not hide a failure for a different file with the same name", () => {
  const failed = fixture("return.pdf", 100, 1);
  const successful = fixture("return.pdf", 200, 2);
  const uploads: any[] = [
    { id: "old", file: failed, name: failed.name, status: "error", error: "bad file", pct: 0 },
    { id: "new", file: successful, name: successful.name, status: "uploading", pct: 80 },
  ];
  const result = reconcileCompletedUpload(uploads, "new", { ok: true });
  assert.equal(result.length, 2);
  assert.equal(result[0].status, "error");
  assert.equal(result[1].status, "success");
});
