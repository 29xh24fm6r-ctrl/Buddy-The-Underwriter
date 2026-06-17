/**
 * SPEC-SPREAD-SOURCE-EVIDENCE-CLEARING-WORKFLOW-1 — UI + route wiring guards.
 *
 * The panel is a client component (source-guarded here); the lifecycle LOGIC is proven by the pure
 * sourceEvidenceStatus / attachSourceEvidence unit tests. These guards lock in that the panel renders
 * the evidence strip on active rows (and only there), the GET route enriches via attachSourceEvidence,
 * and the enrichment reads existing tables (no new route).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("panel renders the evidence-clearing strip", () => {
  const panel = read("src/components/deals/spreads/SpreadReviewActionsPanel.tsx");
  it("MANDATORY strip: renders for active source rows even without server evidence (client fallback)", () => {
    // The strip is driven by rowEvidence(a), which falls back to a client-built lifecycle when the
    // API did not attach one — so the strip never silently disappears for an active source blocker.
    assert.match(panel, /function rowEvidence\(/);
    assert.match(panel, /const ev = rowEvidence\(a\);/);
    assert.match(panel, /<EvidenceStrip ev=\{ev\}/);
    assert.match(panel, /buildSourceEvidenceStatus\(/); // client-side fallback derivation
    assert.match(panel, /documentsUnavailable: true/);
    // fallback only for active source action types
    assert.match(panel, /SOURCE_ACTION_TYPES\.includes\(a\.action_type\) .*isActiveReviewActionStatus\(a\.status\)/s);
  });
  it("the strip shows needed / request / upload / extraction / why-blocking / next-action", () => {
    assert.match(panel, /Evidence needed:/);
    assert.match(panel, /requiredEvidenceSummary/);
    assert.match(panel, /Request:/);
    assert.match(panel, /Upload:/);
    assert.match(panel, /Extraction:/);
    assert.match(panel, /Why still blocking:/);
    assert.match(panel, /Next:/);
    assert.match(panel, /matchingDocuments\.map/);
    assert.match(panel, /requestWarning/);
  });
  it("the strip distinguishes Cleared / Needs regenerate / Still blocking (request created != cleared)", () => {
    assert.match(panel, /Cleared/);
    assert.match(panel, /Needs regenerate/);
    assert.match(panel, /Still blocking/);
  });
  it("the strip lives in the OPEN (active) section, not the reviewed/settled list", () => {
    const openIdx = panel.indexOf("{open.map(");
    const reviewedIdx = panel.indexOf("{reviewed.map(");
    const stripIdx = panel.indexOf("<EvidenceStrip");
    assert.ok(openIdx > -1 && reviewedIdx > openIdx && stripIdx > openIdx && stripIdx < reviewedIdx,
      "EvidenceStrip must be rendered within the open.map block, before reviewed.map");
  });
});

describe("GET /review-actions enriches with evidence (no new route)", () => {
  const route = read("src/app/api/deals/[dealId]/classic-spread/review-actions/route.ts");
  it("GET attaches source evidence via attachSourceEvidence", () => {
    assert.match(route, /import \{ attachSourceEvidence \}/);
    assert.match(route, /const enriched = await attachSourceEvidence\(rows, dealId, access\.bankId\)/);
    assert.match(route, /actions: enriched/);
  });
  it("still exactly one route file with GET/POST/PATCH", () => {
    const dir = path.join(repoRoot, "src/app/api/deals/[dealId]/classic-spread/review-actions");
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".ts")), ["route.ts"]);
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function POST/);
    assert.match(route, /export async function PATCH/);
  });
});

describe("evidence enrichment reuses existing tables", () => {
  const attach = read("src/lib/classicSpread/review/attachSourceEvidence.ts");
  it("reads deal_documents + draft_borrower_requests (no new tables)", () => {
    assert.match(attach, /\.from\("deal_documents"\)/);
    assert.match(attach, /\.from\("draft_borrower_requests"\)/);
  });
  it("only enriches active source-detail / verify rows", () => {
    assert.match(attach, /REQUEST_SOURCE_DETAIL.*VERIFY_SOURCE_LINE/s);
    assert.match(attach, /isActiveReviewActionStatus\(r\.status\)/);
  });
});
