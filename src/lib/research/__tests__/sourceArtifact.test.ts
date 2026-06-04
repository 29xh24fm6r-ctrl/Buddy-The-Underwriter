import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSourceArtifactHtml,
  buildSourceArtifactRow,
  sourceArtifactTitle,
  type SourceArtifactInput,
} from "@/lib/research/sourceArtifact";

/**
 * SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1
 * Pure evidence-receipt builders. (Idempotency, auto-create, and backfill are
 * covered live against OmniCare; the route + ensure server module are exercised
 * there since they require Supabase.)
 */

const CAPTURED = "2026-06-04T19:00:00.000Z";

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
    capturedAt: CAPTURED,
    taskTitle: "Attach Secretary of State / business registry record",
    blockerLabel: "source_quality",
    reviewStatus: "unreviewed",
    limitations: ["Manually attached source — requires analyst review."],
    candidateMetadata: { verify: "x" },
    excerpt: "OK SOS — OmniCare 365",
    ...over,
  };
}

// ── HTML receipt content ──────────────────────────────────────────────────────

test("[html] receipt contains URL, hash, captured timestamp, task/blocker context", () => {
  const html = buildSourceArtifactHtml(input());
  assert.match(html, /Captured Public Source Evidence/);
  assert.match(html, /sos\.ok\.gov\/corp\/corpInquiryFind\.aspx/);
  assert.match(html, /a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6/);
  assert.match(html, /2026-06-04T19:00:00\.000Z/);
  assert.match(html, /Attach Secretary of State \/ business registry record/);
  assert.match(html, /source_quality/);
  assert.match(html, /Captured by Buddy for loan-file evidence review/);
});

test("[html] escapes injected markup in fields", () => {
  const html = buildSourceArtifactHtml(input({ title: "<script>x</script>", excerpt: "a<b>c" }));
  assert.equal(html.includes("<script>x</script>"), false);
  assert.match(html, /&lt;script&gt;/);
});

test("[html] does not claim committee-grade or approval (only the negating disclaimer)", () => {
  const html = buildSourceArtifactHtml(input()).toLowerCase();
  assert.equal(/\bapproved\b/.test(html), false);
  // The only mention of committee-grade is the disclaimer that it is NOT one.
  assert.match(html, /does not by itself constitute committee-grade evidence or approval/);
  assert.match(html, /advisory and requires analyst review/);
});

// ── row builder ───────────────────────────────────────────────────────────────

test("[row] builds an insert row with the HTML receipt and linkage", () => {
  const row = buildSourceArtifactRow(input());
  assert.equal(row.deal_id, "dc52c626");
  assert.equal(row.source_snapshot_id, "snap-1");
  assert.equal(row.task_id, "task-1");
  assert.equal(row.artifact_type, "RESEARCH_SOURCE_SNAPSHOT");
  assert.equal(row.status, "captured");
  assert.equal(row.content_hash?.length, 64);
  assert.ok(row.artifact_html.includes("Captured Public Source Evidence"));
  assert.deepEqual(row.candidate_metadata, { verify: "x" });
});

test("[row] never carries a committee_grade flag (artifact ≠ committee-grade)", () => {
  const row = buildSourceArtifactRow(input()) as Record<string, unknown>;
  assert.equal("committee_grade_accepted" in row, false);
  assert.equal("committee_eligible" in row, false);
});

// ── title helper ──────────────────────────────────────────────────────────────

test("[title] maps source types to friendly provenance labels", () => {
  assert.match(sourceArtifactTitle("borrower_official_website", "OmniCare"), /Captured Source — Borrower Website/);
  assert.match(sourceArtifactTitle("secretary_of_state", null), /Secretary of State/);
  assert.match(sourceArtifactTitle("government_data", "BLS"), /Government Data/);
  assert.match(sourceArtifactTitle("unknown_thing", null), /Captured Source/);
});
