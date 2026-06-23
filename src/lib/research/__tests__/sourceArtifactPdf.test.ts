import test from "node:test";
import assert from "node:assert/strict";

import { renderSourceArtifactPdf } from "@/lib/research/sourceArtifactPdf";
import { buildSourceArtifactReceiptRows, type SourceArtifactInput } from "@/lib/research/sourceArtifact";

/**
 * SPEC-BIE-COMMITTEE-READINESS-FINAL-UX-POLISH-AND-PDF-ARTIFACTS-1 — Phase 2.
 * pdf-lib PDF receipt: valid bytes, deterministic/idempotent, content-complete.
 */

function input(over: Partial<SourceArtifactInput> = {}): SourceArtifactInput {
  return {
    dealId: "dc52c626",
    missionId: "b86df09c",
    sourceSnapshotId: "snap-1",
    taskId: "task-1",
    title: "Captured Source — Secretary of State / Business Registry",
    sourceUrl: "https://www.sos.ok.gov/corp/corpInquiryFind.aspx",
    sourceType: "secretary_of_state",
    sourceDomain: "sos.ok.gov",
    connectorKind: "secretary_of_state",
    connectorMode: "manual_url",
    httpStatus: 200,
    contentHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6",
    capturedAt: "2026-06-04T19:30:00.000Z",
    taskTitle: "Attach Secretary of State / business registry record",
    blockerLabel: "source_quality",
    reviewStatus: "unreviewed",
    limitations: ["Manually attached source — requires analyst review."],
    excerpt: "OK SOS — OmniCare 365",
    ...over,
  };
}

test("[pdf] produces a valid non-empty PDF (%PDF header, %%EOF trailer)", async () => {
  const bytes = await renderSourceArtifactPdf(input());
  assert.ok(bytes.length > 800, "PDF should be non-trivial");
  const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  assert.equal(head, "%PDF-");
  const tail = Buffer.from(bytes.slice(-8)).toString("latin1");
  assert.match(tail, /%%EOF/);
});

test("[pdf] is deterministic / idempotent for identical input", async () => {
  const a = await renderSourceArtifactPdf(input());
  const b = await renderSourceArtifactPdf(input());
  assert.deepEqual(Buffer.from(a), Buffer.from(b), "same input → identical PDF bytes");
});

test("[pdf] receipt rows cover the required evidence fields", () => {
  const labels = buildSourceArtifactReceiptRows(input()).map((r) => r.label);
  for (const l of ["Deal", "Source title", "Source URL", "Source type", "Captured at", "HTTP status", "Content hash (sha256)", "Committee task", "Review status"]) {
    assert.ok(labels.includes(l), `missing receipt field: ${l}`);
  }
});

test("[pdf] different captured timestamps produce different (still-deterministic) bytes", async () => {
  const a = await renderSourceArtifactPdf(input({ capturedAt: "2026-06-04T19:30:00.000Z" }));
  const b = await renderSourceArtifactPdf(input({ capturedAt: "2026-06-05T10:00:00.000Z" }));
  assert.notDeepEqual(Buffer.from(a), Buffer.from(b));
});
