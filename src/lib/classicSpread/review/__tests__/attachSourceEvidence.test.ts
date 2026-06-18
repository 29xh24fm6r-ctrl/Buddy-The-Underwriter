/**
 * SPEC-SPREAD-SOURCE-EVIDENCE-CLEARING-WORKFLOW-1 — server enrichment wiring (GET /review-actions).
 *
 * Proves the GET path attaches evidence ONLY to active source-detail/verify rows, fetches the deal's
 * existing documents + draft requests, and is non-fatal. Uses an in-memory Supabase fake (injected via
 * `client`) so no DB is touched.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { attachSourceEvidence } = require("../attachSourceEvidence") as typeof import("../attachSourceEvidence");

function makeFakeClient(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: [string, any][] = [];
      const builder: any = {
        select() { return builder; },
        eq(c: string, v: any) { filters.push([c, v]); return builder; },
        then(resolve: (x: any) => void) {
          const data = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          resolve({ data, error: null });
        },
      };
      return builder;
    },
  };
}

const DEAL = "dc52c626";
const BANK = "bank-1";

const reviewRow = (over: any = {}) => ({
  id: "ra-tca", deal_id: DEAL, bank_id: BANK, finding_key: "ytd_2026|balance_sheet|total_current_assets|missing_implied_component",
  action_type: "REQUEST_SOURCE_DETAIL", issue_type: "missing_implied_component", statement: "balance_sheet",
  period_label: "YTD 2026", row_label: "TOTAL CURRENT ASSETS", status: "borrower_detail_requested",
  source_value: 198_692.59, recommended_value: 2_898_652.37, diff_value: 2_898_652.37,
  finding_json: { periodEndDate: "3/31/2026", periodIsInterim: true }, ...over,
});

const docs = [
  { id: "bs-mar", deal_id: DEAL, bank_id: BANK, original_filename: "Omnicare 365 Balance Sheet March 2026.pdf", canonical_type: "BALANCE_SHEET", ai_tax_year: 2026, finalized_at: "2026-05-01", is_active: true },
  { id: "ar-apr", deal_id: DEAL, bank_id: BANK, original_filename: "Omnicare 365 AR Aging 4-2026.pdf", canonical_type: "AR_AGING", ai_tax_year: 2026, checklist_key: "AR_AGING", finalized_at: "2026-05-01", is_active: true },
];

describe("attachSourceEvidence", () => {
  it("attaches an evidence lifecycle to the active TCA action (needs bridge, still blocking)", async () => {
    const client = makeFakeClient({ deal_documents: docs, draft_borrower_requests: [] });
    const out = await attachSourceEvidence([reviewRow()], DEAL, BANK, client);
    const ev = out[0].evidence;
    assert.ok(ev, "active source action gets an evidence block");
    assert.equal(ev.uploadStatus, "candidate_uploaded_needs_bridge");
    assert.equal(ev.clearingStatus, "still_blocking");
    assert.equal(ev.matchingDocuments.length, 2);
    assert.match(ev.requiredEvidenceSummary, /Total Current Assets of \$3,097,345/);
  });

  it("does NOT attach evidence to settled (non-active) rows", async () => {
    const client = makeFakeClient({ deal_documents: docs, draft_borrower_requests: [] });
    const out = await attachSourceEvidence([reviewRow({ status: "confirmed_resolved_value" })], DEAL, BANK, client);
    assert.equal(out[0].evidence, undefined);
  });

  it("does NOT attach evidence to non-source action types", async () => {
    const client = makeFakeClient({ deal_documents: docs, draft_borrower_requests: [] });
    const out = await attachSourceEvidence([reviewRow({ action_type: "ACCEPT_AS_REPORTED", status: "open" })], DEAL, BANK, client);
    assert.equal(out[0].evidence, undefined);
  });

  it("links a draft request by finding_key (requestStatus = requested)", async () => {
    const client = makeFakeClient({
      deal_documents: docs,
      draft_borrower_requests: [{ id: "d1", deal_id: DEAL, status: "pending_approval", evidence: [{ source_finding_key: reviewRow().finding_key }] }],
    });
    const out = await attachSourceEvidence([reviewRow({ status: "open" })], DEAL, BANK, client);
    assert.equal(out[0].evidence.requestStatus, "requested");
  });

  it("MANDATORY evidence: a fetch failure still attaches fallback evidence (unknown + warning)", async () => {
    const throwingClient = { from() { throw new Error("boom"); } };
    const out = await attachSourceEvidence([reviewRow()], DEAL, BANK, throwingClient);
    const ev = out[0].evidence;
    assert.ok(ev, "active source row must ALWAYS receive evidence, even when enrichment fails");
    assert.equal(ev.uploadStatus, "unknown");
    assert.equal(ev.extractionStatus, "unknown");
    assert.equal(ev.clearingStatus, "still_blocking");
    assert.deepEqual(ev.matchingDocuments, []);
    assert.match(ev.enrichmentWarning, /could not be loaded/i);
    // borrower_detail_requested status still resolves the request state without the DB
    assert.equal(ev.requestStatus, "requested");
    assert.ok(ev.requiredEvidenceSummary.length > 0);
    // never leaks a raw error
    assert.ok(!/boom/.test(JSON.stringify(ev)));
  });

  it("a document-query ERROR (not a throw) also falls back to unknown evidence", async () => {
    const errClient = {
      from(t: string) {
        return {
          select() { return this; }, eq() { return this; },
          then(resolve: any) {
            if (t === "deal_documents") resolve({ data: null, error: { message: "column does not exist" } });
            else resolve({ data: [], error: null });
          },
        };
      },
    };
    const out = await attachSourceEvidence([reviewRow()], DEAL, BANK, errClient);
    assert.ok(out[0].evidence);
    assert.equal(out[0].evidence.uploadStatus, "unknown");
    assert.match(out[0].evidence.enrichmentWarning, /could not be loaded/i);
  });

  it("normalizes deal_documents.metadata linkage → linked evidence drives fulfilled + needs_regenerate", async () => {
    const linkedDocs = [
      { id: "lk", deal_id: DEAL, bank_id: BANK, original_filename: "Omnicare current asset detail 3-31-2026.pdf",
        canonical_type: "AR_AGING", ai_period_end: "2026-03-31", finalized_at: "2026-05-02", is_active: true,
        created_at: "2026-05-01",
        metadata: { spread_review_action_id: "ra-tca", uploaded_for: "classic_spread_review_action", requested_evidence_kind: "current_asset_detail" } },
    ];
    const client = makeFakeClient({ deal_documents: linkedDocs, draft_borrower_requests: [] });
    const out = await attachSourceEvidence([reviewRow({ status: "open" })], DEAL, BANK, client);
    const ev = out[0].evidence;
    assert.equal(ev.requestStatus, "fulfilled");
    assert.equal(ev.hasLinkedRequestEvidence, true);
    assert.equal(ev.clearingStatus, "needs_regenerate");
    assert.equal(ev.linkedEvidenceDocuments.length, 1);
    assert.equal(ev.linkedEvidenceDocuments[0].id, "lk");
  });

  it("every active source row receives evidence; matchingDocuments may be empty", async () => {
    const client = makeFakeClient({ deal_documents: [], draft_borrower_requests: [] });
    const rows = [reviewRow({ id: "a", status: "open" }), reviewRow({ id: "b", action_type: "VERIFY_SOURCE_LINE", status: "borrower_detail_requested" })];
    const out = await attachSourceEvidence(rows, DEAL, BANK, client);
    assert.ok(out[0].evidence && out[1].evidence);
    assert.deepEqual(out[0].evidence.matchingDocuments, []);
    assert.equal(out[0].evidence.uploadStatus, "no_candidate_uploaded"); // loaded, none found (not "unknown")
  });
});
