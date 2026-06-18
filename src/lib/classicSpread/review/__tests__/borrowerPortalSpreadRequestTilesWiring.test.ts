/**
 * SPEC-BORROWER-PORTAL-SPREAD-REQUEST-TILES-1 — wiring guards (no new route / no new table).
 *
 * The tile LOGIC is proven by the pure borrowerPortalSpreadRequestTiles unit tests. These guards lock
 * in that the portal session route loads the existing tables and projects them via the pure builder,
 * that the borrower portal renders the tiles, and that the tile Upload forwards exact linkage to the
 * existing commit route — preserving the existing checklist tiles unchanged.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("portal session route surfaces spread request tiles (existing tables only)", () => {
  const route = read("src/app/api/portal/session/route.ts");
  it("builds tiles via the pure builder and returns them as spreadRequests", () => {
    assert.match(route, /import \{[\s\S]*buildBorrowerSpreadRequestTiles[\s\S]*\} from "@\/lib\/classicSpread\/review\/borrowerPortalSpreadRequestTiles"/);
    assert.match(route, /buildBorrowerSpreadRequestTiles\(\{/);
    assert.match(route, /spreadRequests,/);
  });
  it("reads draft_borrower_requests + classic_spread_review_actions (no new table)", () => {
    assert.match(route, /\.from\("draft_borrower_requests"\)/);
    assert.match(route, /\.from\("classic_spread_review_actions"\)/);
    // review-action read is bank-scoped
    assert.match(route, /classic_spread_review_actions[\s\S]*\.eq\("bank_id", invite\.bank_id\)/);
  });
  it("the loader is non-fatal (a failure must not break the portal session)", () => {
    assert.match(route, /try \{[\s\S]*buildBorrowerSpreadRequestTiles[\s\S]*\} catch \{[\s\S]*spreadRequests = \[\];[\s\S]*\}/);
  });
  it("still exactly the one session route file (no new route added)", () => {
    const dir = path.join(repoRoot, "src/app/api/portal/session");
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".ts")), ["route.ts"]);
  });
});

describe("borrower portal renders the tiles and forwards exact linkage", () => {
  const ui = read("src/app/portal/[token]/ui.tsx");
  it("renders a clearly labeled Additional evidence requested section from spreadRequests", () => {
    assert.match(ui, /Additional evidence requested/);
    assert.match(ui, /spreadRequests\.map\(/);
    assert.match(ui, /data\?\.spreadRequests \|\| \[\]/);
  });
  it("shows the structured request copy (evidence kind / period / clearing target)", () => {
    assert.match(ui, /formatEvidenceKind\(r\.requestedEvidenceKind\)/);
    assert.match(ui, /r\.requestedPeriod/);
    assert.match(ui, /r\.clearingTarget/);
  });
  it("the tile Upload forwards spreadReviewActionId/spreadFindingKey/draftBorrowerRequestId/requestedEvidenceKind to doUpload", () => {
    assert.match(ui, /spreadReviewActionId: r\.spreadReviewActionId/);
    assert.match(ui, /spreadFindingKey: r\.spreadFindingKey/);
    assert.match(ui, /draftBorrowerRequestId: r\.draftBorrowerRequestId/);
    assert.match(ui, /requestedEvidenceKind: r\.requestedEvidenceKind/);
  });
  it("preserves the existing checklist upload tiles unchanged (task Upload still calls doUpload(null, file, t.checklistKey))", () => {
    assert.match(ui, /await doUpload\(null, file, t\.checklistKey\)/);
  });
});
