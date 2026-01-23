import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBootstrapPayload } from "@/lib/deals/bootstrapPayload";

test("deal bootstrap payload validates files", () => {
  const res = normalizeBootstrapPayload({
    dealName: "Test Deal",
    files: [{ filename: "a.pdf", contentType: "application/pdf", sizeBytes: 123 }],
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.payload.files.length, 1);
  }
});

test("deal bootstrap payload rejects missing files", () => {
  const res = normalizeBootstrapPayload({ dealName: "Test Deal", files: [] });
  assert.equal(res.ok, false);
});
