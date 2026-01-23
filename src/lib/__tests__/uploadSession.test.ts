import test from "node:test";
import assert from "node:assert/strict";
import { buildUploadSession } from "@/lib/uploads/createUploadSession";

test("upload-session returns uploads for each file", async () => {
  const files = [
    { filename: "one.pdf", contentType: "application/pdf", sizeBytes: 123, checklistKey: null },
    { filename: "two.pdf", contentType: "application/pdf", sizeBytes: 456, checklistKey: "PFS" },
  ];

  const uploads = await buildUploadSession({
    req: {} as any,
    dealId: "deal_123",
    files,
    requestId: "req_1",
    signFile: async ({ file, requestId }) => ({
      ok: true,
      upload: {
        fileId: `file_${requestId}`,
        objectKey: `deals/deal_123/${file.filename}`,
        uploadUrl: `https://upload.local/${file.filename}`,
        headers: { "Content-Type": file.contentType || "application/octet-stream" },
        bucket: "bucket",
        checklistKey: file.checklistKey ?? null,
      },
    }),
  });

  assert.equal(uploads.length, files.length);
  assert.equal(uploads[0].objectKey, "deals/deal_123/one.pdf");
  assert.equal(uploads[1].checklistKey, "PFS");
  assert.equal(uploads[1].sizeBytes, 456);
});
