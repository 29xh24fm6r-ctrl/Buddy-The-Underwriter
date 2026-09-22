import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
import { borrowerDocumentAdmission, isBorrowerCollectionPhase } from "../admission";
mockServerOnly();
const require = createRequire(import.meta.url);
const DOC = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-000000000002";
const OTHER_OWNER = "00000000-0000-4000-8000-000000000003";
let authorized = true;
let failedTable = "";
let calls = 0;
let tables: Record<string, any[]>;
const good = {
  id: DOC, deal_id: "deal", bank_id: "bank", source: "borrower", sha256: "abc",
  is_active: true, intake_status: "AUTO_CONFIRMED", quality_status: "PASSED",
  canonical_type: "BALANCE_SHEET", doc_year: 2026, segmented: false,
  ocr_text_length: 1500, logical_key: "BALANCE_SHEET|2026|business",
  gatekeeper_needs_review: false, gatekeeper_route: "STANDARD", ai_form_numbers: [], statement_period: "CURRENT",
};
const sb = { from(table: string) {
  calls++;
  const filters: Array<(r: any) => boolean> = [];
  let patch: any = null, insert: any = null, single = false;
  const q: any = {
    select: () => q, order: () => q, limit: () => q,
    eq: (key: string, value: any) => { filters.push(r => r[key] === value); return q; },
    neq: (key: string, value: any) => { filters.push(r => r[key] !== value); return q; },
    is: (key: string, value: any) => { filters.push(r => r[key] === value); return q; },
    in: (key: string, values: any[]) => { filters.push(r => values.includes(r[key])); return q; },
    contains: (key: string, value: any) => { filters.push(r => Object.entries(value).every(([k,v]) => r[key]?.[k] === v)); return q; },
    update: (value: any) => { patch = value; return q; },
    insert: (value: any) => { insert = value; return q; },
    maybeSingle: () => { single = true; return q; },
    then(resolve: any, reject: any) {
      if (table === failedTable) return Promise.resolve({ data: null, error: new Error("DB unavailable") }).then(resolve, reject);
      if (insert) tables[table].push(insert);
      const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
      if (patch) rows.forEach(r => Object.assign(r, patch));
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
    },
  };
  return q;
} };
require.cache[require.resolve("@/lib/supabase/admin")] = { id: "sb", filename: "sb", loaded: true, exports: { supabaseAdmin: () => sb } } as any;
require.cache[require.resolve("@/lib/borrower/resolvePortalContext")] = { id: "ctx", filename: "ctx", loaded: true, exports: { resolvePortalContext: async () => { if (!authorized) throw new Error("unauthorized"); return { dealId: "deal", bankId: "bank" }; } } } as any;
const service = require("../service") as typeof import("../service");
const { POST } = require("../../../../app/api/borrower/portal/[token]/documents/process/route") as typeof import("../../../../app/api/borrower/portal/[token]/documents/process/route");
const { GET } = require("../../../../app/api/borrower/portal/[token]/documents/route") as typeof import("../../../../app/api/borrower/portal/[token]/documents/route");
const { applyDocumentClarification } = require("../clarification") as typeof import("../clarification");
beforeEach(() => {
  authorized = true; failedTable = ""; calls = 0;
  tables = { deals: [{ id: "deal", bank_id: "bank", origin: "brokerage_claimed", intake_phase: "CLASSIFIED_PENDING_CONFIRMATION" }],
    deal_documents: [{ ...good }], buddy_sealed_packages: [], deal_events: [],
    ownership_entities: [{ id: OWNER, deal_id: "deal", display_name: "QA Test Owner", entity_type: "person" }, { id: OTHER_OWNER, deal_id: "other-deal", display_name: "Other Borrower", entity_type: "person" }],
    document_artifacts: [{ id: "artifact", source_id: DOC, source_table: "deal_documents", deal_id: "deal", bank_id: "bank", status: "classified" }],
  };
});
const request = (body: any) => POST({ json: async () => body } as any, { params: Promise.resolve({ token: "session-bound-deal" }) });

test("readable auto-confirmed borrower document resumes without a staff session, exactly once", async () => {
  assert.equal(await service.canAutomaticallyProcessBorrowerDocument("deal", "bank", DOC, sb as any), true);
  assert.equal((await (await request({})).json()).queued, 1);
  assert.equal((await (await request({})).json()).queued, 0);
});
for (const [field, value] of [["quality_status", null], ["ocr_text_length", 0], ["is_active", false], ["segmented", true], ["canonical_type", null], ["intake_status", "CLASSIFIED_PENDING_REVIEW"], ["gatekeeper_needs_review", true], ["source", "internal"]] as const) {
  test(`automatic admission stops for ${field}=${value}`, () => assert.notEqual(borrowerDocumentAdmission({ ...good, [field]: value }), null));
}
for (const phase of [null, "unknown", "CONFIRMED_READY_FOR_PROCESSING", "PROCESSING", "PROCESSING_COMPLETE"]) {
  test(`unknown/frozen phase ${phase} is not borrower collection`, () => assert.equal(isBorrowerCollectionPhase(phase), false));
}
test("tax returns require both a year and resolved owner", () => {
  assert.equal(borrowerDocumentAdmission({ ...good, canonical_type: "BUSINESS_TAX_RETURN", doc_year: null }), "tax_year");
  assert.equal(borrowerDocumentAdmission({ ...good, canonical_type: "BUSINESS_TAX_RETURN", logical_key: null }), "document_owner");
});
test("bank-managed deals cannot use the automated borrower gate", async () => {
  tables.deals[0].origin = "banker";
  assert.equal(await service.canAutomaticallyProcessBorrowerDocument("deal", "bank", DOC, sb as any), false);
});
test("a sealed package prevents borrower reprocessing", async () => {
  tables.buddy_sealed_packages.push({ deal_id: "deal", id: "sealed", unsealed_at: null });
  assert.equal((await request({ documentId: DOC })).status, 404);
  assert.equal(tables.document_artifacts[0].status, "classified");
});
test("a different bank cannot resolve the document", async () => {
  assert.equal(await service.readBorrowerDocument("deal", "other-bank", DOC, sb as any), null);
});
test("a document on another application cannot be changed", async () => {
  tables.deal_documents[0].deal_id = "other-deal";
  assert.equal((await request({ documentId: DOC, clarification: { doc_type: "OTHER" } })).status, 404);
  assert.equal(tables.deal_events.length, 0);
});
test("invalid session is rejected before privileged reads or writes", async () => {
  authorized = false;
  assert.equal((await request({ documentId: DOC })).status, 403);
  assert.equal(calls, 0);
});
test("document clarification is tied to the exact file hash and queued through the existing worker", async () => {
  const response = await request({ documentId: DOC, clarification: { doc_type: "BALANCE_SHEET", statement_period: "CURRENT" } });
  assert.equal(response.status, 200);
  assert.equal(tables.deal_events[0].payload.sha256, "abc");
  assert.equal(tables.document_artifacts[0].status, "queued");
  assert.equal((await service.readDocumentClarification("deal", "bank", DOC, sb as any))?.doc_type, "BALANCE_SHEET");
  tables.deal_documents[0].sha256 = "changed";
  assert.equal(await service.readDocumentClarification("deal", "bank", DOC, sb as any), null);
});
test("borrower cannot override detected IRS form number", async () => {
  tables.deal_documents[0].ai_form_numbers = ["1040"];
  assert.equal((await request({ documentId: DOC, clarification: { doc_type: "BUSINESS_TAX_RETURN", tax_year: 2025 } })).status, 422);
  assert.equal(tables.deal_events.length, 0);
});
test("matching canonical borrower type is accepted for a detected IRS form number", async () => {
  tables.deal_documents[0].ai_form_numbers = ["1040"];
  const response = await request({ documentId: DOC, clarification: { doc_type: "PERSONAL_TAX_RETURN", tax_year: 2025, ownership_entity_id: OWNER } });
  assert.equal(response.status, 200);
  assert.equal(tables.deal_events[0].payload.ownership_entity_id, OWNER);
});
test("missing tax year and statement period stay actionable rather than inventing values", async () => {
  for (const doc_type of ["BUSINESS_TAX_RETURN", "BALANCE_SHEET"]) assert.equal((await request({ documentId: DOC, clarification: { doc_type } })).status, 422);
});
test("borrower confirmation cannot approve an unreadable or bundled file", async () => {
  tables.deal_documents[0].ocr_text_length = 12;
  assert.equal((await request({ documentId: DOC, clarification: { doc_type: "OTHER" } })).status, 422);
  tables.deal_documents[0].ocr_text_length = 1000; tables.deal_documents[0].segmented = true;
  assert.equal((await request({ documentId: DOC, clarification: { doc_type: "OTHER" } })).status, 422);
});
test("database failure never returns successful admission or resumes work", async () => {
  failedTable = "buddy_sealed_packages";
  assert.equal((await request({ documentId: DOC })).status, 503);
  assert.equal(tables.document_artifacts[0].status, "classified");
});
test("queue failure after a saved clarification remains retryable and is reported", async () => {
  failedTable = "document_artifacts";
  assert.equal((await request({ documentId: DOC, clarification: { doc_type: "OTHER" } })).status, 503);
  assert.equal(tables.deal_events.length, 1);
});
test("borrower clarification preserves AI evidence and identifies its human source", () => {
  const classified: any = { docType: "OTHER", confidence: .7, taxYear: null, formNumbers: [], entityType: "business", rawExtraction: { original: true } };
  const result = applyDocumentClarification(classified, { doc_type: "BALANCE_SHEET", statement_period: "CURRENT" });
  assert.equal(result.model, "borrower_clarification");
  assert.equal(result.rawExtraction.prior_classifier_confidence, .7);
  assert.equal(result.rawExtraction.original, true);
});

test("withdrawn document cannot be resumed or clarified", async () => {
  tables.deal_documents[0].status = "withdrawn";
  assert.notEqual(borrowerDocumentAdmission(tables.deal_documents[0]), null);
  assert.equal(await service.resumeBorrowerDocuments("deal", "bank", sb as any), 0);
  assert.equal((await request({ documentId: DOC })).status, 404);
});
test("a processing file does not falsely report that clarification restarted it", async () => {
  tables.document_artifacts[0].status = "processing";
  assert.equal((await request({ documentId: DOC, clarification: { doc_type: "OTHER" } })).status, 409);
});

test("borrower can save type and year while a newly uploaded document waits in queue", async () => {
  Object.assign(tables.deal_documents[0], {
    quality_status: null, canonical_type: null, doc_year: null,
    intake_status: null, ocr_text_length: 0, logical_key: null,
  });
  tables.document_artifacts[0].status = "queued";
  const response = await request({ documentId: DOC, clarification: { doc_type: "PERSONAL_TAX_RETURN", tax_year: 2025, ownership_entity_id: OWNER } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.clarificationSaved, true);
  assert.equal(body.processing, true);
  assert.equal(tables.document_artifacts[0].status, "queued");
  assert.equal(tables.deal_events[0].payload.tax_year, 2025);
  assert.equal(tables.deal_events[0].payload.ownership_entity_id, OWNER);
});

test("owner-scoped documents require an owner on the same application", async () => {
  const missing = await request({ documentId: DOC, clarification: { doc_type: "PERSONAL_TAX_RETURN", tax_year: 2025 } });
  assert.equal(missing.status, 422);
  const crossDeal = await request({ documentId: DOC, clarification: { doc_type: "PERSONAL_TAX_RETURN", tax_year: 2025, ownership_entity_id: OTHER_OWNER } });
  assert.equal(crossDeal.status, 422);
  assert.equal(tables.deal_events.length, 0);
});

test("owner lookup failures fail closed without saving a clarification", async () => {
  failedTable = "ownership_entities";
  const response = await request({ documentId: DOC, clarification: { doc_type: "PERSONAL_TAX_RETURN", tax_year: 2025, ownership_entity_id: OWNER } });
  assert.equal(response.status, 503);
  assert.equal(tables.deal_events.length, 0);
});

test("saved owner association is hash-bound and revalidated when processing consumes it", async () => {
  tables.deal_events.push({ deal_id: "deal", kind: "borrower.document.clarified", created_at: "2026-09-22T00:00:00Z", payload: {
    document_id: DOC, sha256: "abc", doc_type: "PERSONAL_TAX_RETURN", tax_year: 2025, statement_period: null, ownership_entity_id: OWNER,
  } });
  const saved = await service.readDocumentClarification("deal", "bank", DOC, sb as any);
  assert.equal(saved?.ownership_entity_id, OWNER);
  assert.equal(saved?.ownership_entity_name, "QA Test Owner");
  tables.ownership_entities[0].deal_id = "other-deal";
  await assert.rejects(service.readDocumentClarification("deal", "bank", DOC, sb as any), /no longer available/);
});

test("known unreadable queued document cannot be self-described around quality controls", async () => {
  Object.assign(tables.deal_documents[0], { quality_status: "FAILED_LOW_TEXT", ocr_text_length: 0 });
  tables.document_artifacts[0].status = "queued";
  assert.equal((await request({ documentId: DOC, clarification: { doc_type: "OTHER" } })).status, 422);
  assert.equal(tables.deal_events.length, 0);
});

const list = async () => (await GET({} as any, { params: Promise.resolve({ token: "session-bound-deal" }) })).json();
test("document list distinguishes processed work from a retry with stale completion metadata", async () => {
  Object.assign(tables.document_artifacts[0], { status: "matched", match_reason: "borrower_automated_processing_complete" });
  assert.equal((await list()).documents[0].processingComplete, true);
  tables.document_artifacts[0].status = "failed";
  const doc = (await list()).documents[0];
  assert.equal(doc.processingComplete, false);
  assert.equal(doc.canRetry, true);
});
test("document list offers clarification only for editable borrower applications", async () => {
  tables.deal_documents[0].gatekeeper_needs_review = true;
  assert.equal((await list()).documents[0].canClarify, true);
  tables.deals[0].origin = "banker";
  assert.equal((await list()).documents[0].canClarify, false);
  tables.deals[0].origin = "brokerage_claimed";
  tables.buddy_sealed_packages.push({ deal_id: "deal", id: "sealed", unsealed_at: null });
  assert.equal((await list()).documents[0].canClarify, false);
});

test("document list exposes saved borrower details while automated processing is queued", async () => {
  Object.assign(tables.deal_documents[0], {
    quality_status: null, canonical_type: null, doc_year: null,
    intake_status: null, ocr_text_length: 0, logical_key: null,
  });
  tables.document_artifacts[0].status = "queued";
  tables.deal_events.push({
    deal_id: "deal", kind: "borrower.document.clarified", created_at: "2026-09-22T00:00:00Z",
    payload: { document_id: DOC, sha256: "abc", doc_type: "PERSONAL_TAX_RETURN", tax_year: 2024, statement_period: null, ownership_entity_id: OWNER },
  });
  const doc = (await list()).documents[0];
  assert.equal(doc.canClarify, true);
  assert.equal(doc.clarificationSaved, true);
  assert.equal(doc.suggestedType, "PERSONAL_TAX_RETURN");
  assert.equal(doc.taxYear, 2024);
  assert.equal(doc.ownershipEntityId, OWNER);
  assert.deepEqual(doc.ownerOptions.map((owner: any) => owner.id), [OWNER]);
  assert.match(doc.actionMessage, /Details saved/);
});
