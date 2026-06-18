/**
 * SPEC-LINKED-EVIDENCE-REGENERATE-CLOSE-LOOP-1 — end-to-end lifecycle after a borrower uploads linked
 * evidence for a spread review action.
 *
 * Proves the honest close-loop:
 *   request -> linked upload -> extraction -> regenerate (audit re-run) -> syncReviewActions prune ->
 *   the row closes ONLY because the latest audit no longer emits the finding -> the Evidence Strip
 *   flips needs_regenerate -> cleared_after_regenerate, and certificationSummary stops counting it.
 *
 * Closure is a consequence of audit ABSENCE only — never of upload / extraction / request metadata.
 * Uses OmniCare-shaped fixtures + an in-memory Supabase fake (no DB).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

import { buildSourceEvidenceStatus, type EvidenceCandidateDoc, type EvidenceReviewAction } from "../sourceEvidenceStatus";
import { buildClassicSpreadCertificationSummary } from "../../certification/certificationSummary";
import { isActiveReviewActionStatus } from "../reviewActionStatus";
import type { ClassicSpreadCertificationAudit } from "../../certification/certifiedSpreadGateCore";
import type { SpreadAuditFinding, SpreadAuditResult } from "../../audit/spreadAccuracyAudit";

mockServerOnly();
const require = createRequire(import.meta.url);
const { syncReviewActions } = require("../reviewActionsRepo") as typeof import("../reviewActionsRepo");

// ── in-memory Supabase fake (supports eq + multiple in + upsert/select/update) ──────────────────
function makeFakeClient(initialRows: any[]) {
  const store = { rows: initialRows.map((r) => ({ ...r })) };
  const matches = (row: any, filters: [string, any][], inF: [string, Set<any>][]) => {
    for (const [c, v] of filters) if (row[c] !== v) return false;
    for (const [c, set] of inF) if (!set.has(row[c])) return false;
    return true;
  };
  const makeBuilder = () => {
    const st: any = { op: null, filters: [], inFilters: [], payload: null, upsertRows: null };
    const exec = () => {
      if (st.op === "upsert") {
        for (const r of st.upsertRows ?? []) {
          const i = store.rows.findIndex((x) => x.bank_id === r.bank_id && x.deal_id === r.deal_id && x.finding_key === r.finding_key);
          if (i >= 0) store.rows[i] = { ...store.rows[i], ...r };
          else store.rows.push({ id: `gen-${store.rows.length + 1}`, status: "open", reviewer_user_id: null, decision_json: null, reviewed_at: null, ...r });
        }
        return { data: null, error: null };
      }
      if (st.op === "select") return { data: store.rows.filter((r) => matches(r, st.filters, st.inFilters)).map((r) => ({ ...r })), error: null };
      if (st.op === "update") { for (const row of store.rows) if (matches(row, st.filters, st.inFilters)) Object.assign(row, st.payload); return { data: null, error: null }; }
      return { data: null, error: null };
    };
    const b: any = {
      upsert(rows: any[]) { st.op = "upsert"; st.upsertRows = rows; return b; },
      select() { st.op = "select"; return b; },
      update(p: any) { st.op = "update"; st.payload = p; return b; },
      eq(c: string, v: any) { st.filters.push([c, v]); return b; },
      in(c: string, vals: any[]) { st.inFilters.push([c, new Set(vals)]); return b; },
      then(resolve: (v: any) => void) { resolve(exec()); },
    };
    return b;
  };
  return { client: { from: () => makeBuilder() }, store };
}

// ── OmniCare-shaped fixtures ────────────────────────────────────────────────────────────────────
const FK = "ytd_2026|balance_sheet|total_current_assets|missing_implied_component";
const DEAL = "deal-omni";
const BANK = "bank-1";

const tcaAction = (over: Partial<EvidenceReviewAction> = {}): EvidenceReviewAction => ({
  id: "row-" + FK, findingKey: FK, actionType: "REQUEST_SOURCE_DETAIL", issueType: "missing_implied_component",
  statement: "balance_sheet", periodLabel: "YTD 2026", rowLabel: "TOTAL CURRENT ASSETS", status: "borrower_detail_requested",
  sourceValue: 198_692.59, recommendedValue: 2_898_652.37, diffValue: 2_898_652.37,
  periodEndDate: "3/31/2026", periodIsInterim: true, ...over,
});

const linkedExactDoc: EvidenceCandidateDoc = {
  id: "lk", filename: "Omnicare current asset detail 3-31-2026.pdf", canonicalType: "AR_AGING",
  checklistKey: "AR_AGING", documentLabel: null, periodEnd: "2026-03-31", taxYear: 2026,
  extractionStatus: "extracted", isActive: true, linkedReviewActionId: "row-" + FK, finalizedAt: "2026-05-02", receivedAt: "2026-05-01",
};

const reviewActionRow = (over: Record<string, any> = {}) => ({
  id: "row-" + FK, deal_id: DEAL, bank_id: BANK, finding_key: FK, action_type: "REQUEST_SOURCE_DETAIL",
  issue_type: "missing_implied_component", statement: "balance_sheet", period_label: "YTD 2026",
  row_label: "TOTAL CURRENT ASSETS", status: "borrower_detail_requested", severity: "blocker",
  recommended_value: 2_898_652.37, source_value: 198_692.59, diff_value: 2_898_652.37,
  reviewer_user_id: "user_banker", decision_json: null, reviewed_at: null, finding_json: {}, ...over,
});

const finding = (over: Partial<SpreadAuditFinding> = {}): SpreadAuditFinding => ({
  period: "2026", statement: "balance_sheet", rowLabel: "TOTAL CURRENT ASSETS", issueType: "missing_implied_component",
  expectedValue: null, actualValue: null, difference: null, tolerance: 1, sourceFactIds: [], documentIds: [],
  severity: "blocker", detail: "implied AR", ...over,
});
const spreadAccuracy = (findings: SpreadAuditFinding[]): SpreadAuditResult => ({
  status: findings.some((f) => f.severity === "blocker") ? "blocker" : "clean", findings,
  summary: { blockers: 0, warnings: 0, infos: 0, periodsAudited: [], footingsChecked: 0, mappedFactKeys: 0, unmappedFactKeys: 0 },
  blockedCells: [], actionSummary: { byPeriod: {}, byDocument: {}, byAction: {}, unresolvedActionCount: 0, actions: [] },
});
const auditWith = (findings: SpreadAuditFinding[]): ClassicSpreadCertificationAudit => ({
  certificationVersion: 0,
  domains: {
    balance_sheet: { status: "clean", blocked: [] }, personal_income: { status: "clean", replacements: [] },
    global_cash_flow: { status: "clean", preliminary: false, blocked: [] }, ratios: { status: "clean", suppressed: [] },
  },
  dependencyStatuses: { personalIncome: "ok" }, suppressions: [], spreadAccuracy: spreadAccuracy(findings),
});
const activeCount = (store: any) =>
  store.rows.filter((r: any) => r.deal_id === DEAL && r.bank_id === BANK && isActiveReviewActionStatus(r.status)).length;

// ── the close-loop ───────────────────────────────────────────────────────────────────────────────
describe("linked exact evidence → regenerate → close (cleared only after audit absence)", () => {
  it("step 1: linked extracted exact evidence on an ACTIVE action → needs_regenerate, NOT cleared", () => {
    const ev = buildSourceEvidenceStatus({ action: tcaAction(), documents: [linkedExactDoc] });
    assert.equal(ev.requestStatus, "fulfilled");
    assert.equal(ev.clearingStatus, "needs_regenerate");
    assert.equal(ev.regenerateRecommended, true);
    assert.notEqual(ev.clearingStatus, "cleared_after_regenerate"); // upload+extract != cleared
  });

  it("step 2: regenerate emits an audit WITHOUT the finding → syncReviewActions closes the stale row", async () => {
    const { client, store } = makeFakeClient([reviewActionRow()]);
    assert.equal(activeCount(store), 1);
    const res = await syncReviewActions({ dealId: DEAL, bankId: BANK, actions: [], client }); // finding gone
    assert.equal(res.closed, 1);
    assert.equal(store.rows[0].status, "closed");
    assert.equal(activeCount(store), 0); // no longer counted as open
  });

  it("step 3: with the row now closed, the Evidence Strip reads cleared_after_regenerate", () => {
    const ev = buildSourceEvidenceStatus({ action: tcaAction({ status: "closed" }), documents: [linkedExactDoc] });
    assert.equal(ev.clearingStatus, "cleared_after_regenerate");
    assert.match(ev.clearingExplanation, /Cleared after regenerate/);
  });

  it("step 4: certificationSummary stops counting the closed action and can certify", () => {
    // open-action count is derived from ACTIVE rows only (closed excluded); audit no longer emits the blocker.
    const blocked = buildClassicSpreadCertificationSummary({ certified: true, audit: auditWith([finding()]), openReviewActionCount: 1 });
    assert.equal(blocked.status, "blocked");
    const cleared = buildClassicSpreadCertificationSummary({ certified: true, audit: auditWith([]), openReviewActionCount: 0 });
    assert.equal(cleared.status, "certified");
    assert.equal(cleared.openReviewActionCount, 0);
  });
});

describe("candidate-only uploads never fulfill or close", () => {
  it("a candidate (no linkage metadata) does not fulfill the request", () => {
    const candidate: EvidenceCandidateDoc = { ...linkedExactDoc, id: "cand", linkedReviewActionId: null };
    const ev = buildSourceEvidenceStatus({ action: tcaAction(), documents: [candidate] });
    assert.equal(ev.hasLinkedRequestEvidence, false);
    assert.notEqual(ev.requestStatus, "fulfilled");
    assert.equal(ev.candidateDocuments.length, 1);
    assert.equal(ev.linkedEvidenceDocuments.length, 0);
  });

  it("a still-emitted finding keeps the row active through sync (candidate does not close it)", async () => {
    const { client, store } = makeFakeClient([reviewActionRow({ status: "open" })]);
    const res = await syncReviewActions({ dealId: DEAL, bankId: BANK, actions: [{
      findingKey: FK, periodLabel: "YTD 2026", statement: "balance_sheet", rowLabel: "TOTAL CURRENT ASSETS",
      actionType: "REQUEST_SOURCE_DETAIL", issueType: "missing_implied_component", severity: "blocker",
      recommendedValue: 2_898_652.37, sourceValue: 198_692.59, diffValue: 2_898_652.37, sourceDocumentId: null, findingJson: {} as any,
    }], client });
    assert.equal(res.closed, 0);
    assert.equal(store.rows[0].status, "open"); // still blocking — candidate did not clear it
    assert.equal(activeCount(store), 1);
  });
});

describe("wrong-period linked upload stays blocking unless the audit removes the finding", () => {
  const wrongPeriodLinked: EvidenceCandidateDoc = { ...linkedExactDoc, id: "ar4", filename: "Omnicare AR Aging 4-2026.pdf", periodEnd: "2026-04-28" };

  it("linked 4/28 AR aging (extracted, no bridge) → still_blocking / needs_bridge, NOT needs_regenerate", () => {
    const ev = buildSourceEvidenceStatus({ action: tcaAction(), documents: [wrongPeriodLinked] });
    assert.equal(ev.clearingStatus, "still_blocking");
    assert.equal(ev.uploadStatus, "candidate_uploaded_needs_bridge");
    assert.match(ev.blockingReason, /bridge/i);
  });

  it("regenerate that still emits the finding keeps it open; only audit absence closes it", async () => {
    const { client, store } = makeFakeClient([reviewActionRow()]);
    // finding still emitted after regenerate (4/28 didn't reconcile) → stays active
    await syncReviewActions({ dealId: DEAL, bankId: BANK, actions: [{
      findingKey: FK, periodLabel: "YTD 2026", statement: "balance_sheet", rowLabel: "TOTAL CURRENT ASSETS",
      actionType: "REQUEST_SOURCE_DETAIL", issueType: "missing_implied_component", severity: "blocker",
      recommendedValue: 0, sourceValue: 0, diffValue: 0, sourceDocumentId: null, findingJson: {} as any,
    }], client });
    assert.equal(store.rows[0].status, "borrower_detail_requested");
    // only when the audit legitimately stops emitting it does the row close
    await syncReviewActions({ dealId: DEAL, bankId: BANK, actions: [], client });
    assert.equal(store.rows[0].status, "closed");
  });
});

describe("2022 TLNW candidate stays blocking (tax return is candidate, not linked)", () => {
  it("the extracted 2022 1120 candidate does not fulfill or clear the TLNW blocker", () => {
    const tlnwAction: EvidenceReviewAction = {
      id: "row-tlnw", findingKey: "2022|balance_sheet|total_liabilities_&_net_worth|unreconciled_total",
      actionType: "VERIFY_SOURCE_LINE", issueType: "unreconciled_total", statement: "balance_sheet",
      periodLabel: "2022", rowLabel: "TOTAL LIABILITIES & NET WORTH", status: "open",
      sourceValue: 1_489_099, recommendedValue: 3_268_740, diffValue: 1_779_641, periodEndDate: "12/31/2022", periodIsInterim: false,
    };
    const tr2022: EvidenceCandidateDoc = {
      id: "tr", filename: "Omnicare 365 1120 2022.pdf", canonicalType: "BUSINESS_TAX_RETURN", checklistKey: "IRS_BUSINESS_2022",
      documentLabel: null, periodEnd: null, taxYear: 2022, extractionStatus: "extracted", isActive: true,
    };
    const ev = buildSourceEvidenceStatus({ action: tlnwAction, documents: [tr2022] });
    assert.equal(ev.hasLinkedRequestEvidence, false);
    assert.equal(ev.clearingStatus, "still_blocking");
    assert.match(ev.blockingReason, /Schedule L liability\/equity side does not reconcile/);
  });
});
