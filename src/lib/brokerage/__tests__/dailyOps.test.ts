import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildDailyOpsReport } = require("../dailyOps") as typeof import("../dailyOps");
type Row = Record<string, any>;
const NOW = new Date("2026-07-15T14:00:00Z");
function empty() { return { now: NOW, sessions: [] as Row[], deals: [] as Row[], concierges: [] as Row[], stories: [] as Row[], documents: [] as Row[], scores: [] as Row[], tridents: [] as Row[], sealedPackages: [] as Row[], listings: [] as Row[], claims: [] as Row[], picks: [] as Row[], accesses: [] as Row[], closingWorkflows: [] as Row[], closingConditions: [] as Row[], fundingVerifications: [] as Row[], feeLedger: [] as Row[], disclosures: [] as Row[], form159Records: [] as Row[] }; }
test("no issues → GREEN", () => { assert.equal(buildDailyOpsReport(empty()).status, "GREEN"); });
test("score failure → RED", () => { const i = empty(); i.deals = [{ id: "d1", updated_at: "2026-07-14" }]; i.scores = [{ deal_id: "d1", score_status: "failed" }]; assert.equal(buildDailyOpsReport(i).status, "RED"); });
test("stuck → YELLOW", () => { const i = empty(); i.deals = [{ id: "d1", updated_at: new Date(NOW.getTime() - 48 * 3600000).toISOString() }]; const r = buildDailyOpsReport(i); assert.equal(r.status, "YELLOW"); assert.ok(r.followups.some(f => f.message.includes("stuck"))); });
test("overdue condition → RED", () => { const i = empty(); i.closingConditions = [{ status: "open", due_date: "2026-07-10" }]; assert.equal(buildDailyOpsReport(i).status, "RED"); });
test("missing verification → RED", () => { const i = empty(); i.closingWorkflows = [{ deal_id: "d1", status: "funded" }]; assert.equal(buildDailyOpsReport(i).status, "RED"); });
test("ready to seal", () => { const i = empty(); i.deals = [{ id: "d1", updated_at: NOW.toISOString() }]; i.scores = [{ deal_id: "d1" }]; i.tridents = [{ deal_id: "d1", status: "succeeded" }]; assert.equal(buildDailyOpsReport(i).borrower.readyToSeal, 1); });
test("awaiting pick", () => { const i = empty(); i.listings = [{ id: "l1", deal_id: "d1", status: "awaiting_borrower_pick" }]; assert.equal(buildDailyOpsReport(i).marketplace.awaitingBorrowerPick, 1); });
test("revenue MTD/YTD", () => { const i = empty(); i.feeLedger = [{ deal_id: "d1", fee_type: "borrower_packaging", amount_cents: 100000, status: "funded", funding_verified_at: "2026-07-15T10:00:00Z" }, { deal_id: "d1", fee_type: "lender_referral", amount_cents: 850000, status: "funded", funding_verified_at: "2026-07-15T10:00:00Z" }, { deal_id: "d2", fee_type: "borrower_packaging", amount_cents: 100000, status: "funded", funding_verified_at: "2026-07-10T10:00:00Z" }]; i.fundingVerifications = [{ deal_id: "d1", status: "verified", created_at: "2026-07-15T10:00:00Z" }, { deal_id: "d2", status: "verified", created_at: "2026-07-10T10:00:00Z" }]; const r = buildDailyOpsReport(i); assert.equal(r.revenue.todayCents, 950000); assert.equal(r.revenue.mtdCents, 1050000); });
test("JSON serializable", () => { const r = buildDailyOpsReport(empty()); const j = JSON.parse(JSON.stringify(r)); assert.ok(["GREEN","YELLOW","RED"].includes(j.status)); });
test("critical vs followup separate", () => { const i = empty(); i.deals = [{ id: "d1", updated_at: new Date(NOW.getTime() - 48 * 3600000).toISOString() }]; i.scores = [{ deal_id: "d1", score_status: "failed" }]; const r = buildDailyOpsReport(i); assert.ok(r.criticalActions.every(a => a.severity === "critical")); assert.ok(r.followups.every(a => a.severity === "followup")); });
