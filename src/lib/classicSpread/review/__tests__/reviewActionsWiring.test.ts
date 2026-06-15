import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

/** SPEC-CLASSIC-SPREAD-BANKER-REVIEW-ACTIONS-1 — data model, idempotency, single route, wiring. */

describe("migration", () => {
  const sql = read("supabase/migrations/20260615_classic_spread_review_actions.sql");
  it("creates classic_spread_review_actions with the required columns + unique finding key", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.classic_spread_review_actions/);
    assert.match(sql, /UNIQUE \(bank_id, deal_id, finding_key\)/);
    for (const col of ["period_label", "row_label", "action_type", "issue_type", "severity", "status", "finding_key", "finding_json", "reviewer_user_id", "reviewed_at", "decision_json"]) {
      assert.match(sql, new RegExp(`\\b${col}\\b`), `missing column ${col}`);
    }
  });
  it("enforces the status CHECK and enables RLS (service-role only)", () => {
    assert.match(sql, /CHECK \(status IN \(/);
    assert.match(sql, /'borrower_detail_requested'/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  });
  it("SECURITY DEFINER trigger sets search_path", () => {
    assert.match(sql, /SET search_path = public, pg_catalog/);
  });
});

describe("idempotent sync", () => {
  const repo = read("src/lib/classicSpread/review/reviewActionsRepo.ts");
  it("upserts on (bank_id, deal_id, finding_key) and does NOT send status/reviewer columns", () => {
    assert.match(repo, /onConflict: "bank_id,deal_id,finding_key"/);
    // the synced row payload must not include status/reviewer/decision so a decision is preserved
    const syncBody = repo.slice(repo.indexOf("const rows = actions.map"), repo.indexOf("const { error }"));
    assert.doesNotMatch(syncBody, /\bstatus:/);
    assert.doesNotMatch(syncBody, /reviewer_user_id:/);
  });
  it("decisions stamp reviewed_at only when not 'open' (anti silent-clear)", () => {
    assert.match(repo, /status === "open" \? null : new Date\(\)\.toISOString\(\)/);
  });
});

describe("single route file (no route explosion)", () => {
  it("exactly one route file under classic-spread/review-actions handling GET/POST/PATCH", () => {
    const dir = path.join(repoRoot, "src/app/api/deals/[dealId]/classic-spread/review-actions");
    const files = fs.readdirSync(dir).filter((f) => f === "route.ts");
    assert.equal(files.length, 1);
    const route = read("src/app/api/deals/[dealId]/classic-spread/review-actions/route.ts");
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function POST/);
    assert.match(route, /export async function PATCH/);
    assert.match(route, /ensureDealBankAccess/); // bank scope on every method
  });
});

describe("loader consumes decisions", () => {
  it("applies reviewed decisions to the audit (non-fatal)", () => {
    const loader = read("src/lib/classicSpread/classicSpreadLoader.ts");
    assert.match(loader, /loadReviewDecisions/);
    assert.match(loader, /applyReviewDecisions\(gate\.audit\.spreadAccuracy, decisions\)/);
  });
});
