/**
 * Regression guard tests for lifecycle bootstrap, naming trigger,
 * readiness terminal BLOCKED, and borrower attachment.
 *
 * These tests exercise pure logic and guard functions — no DB or network.
 *
 * Run: pnpm test:unit
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ─── 1. bootstrapDealLifecycle is idempotent ──────────────────────────────────

describe("bootstrapDealLifecycle idempotency", () => {
  /**
   * Simulates the bootstrap upsert logic:
   *   INSERT INTO deal_status (deal_id, stage) VALUES (...)
   *   ON CONFLICT (deal_id) DO NOTHING
   *
   * The function must:
   *   - Create a row if none exists
   *   - NOT overwrite an existing row
   *   - Return { ok: true, created: true } on first call
   *   - Return { ok: true, created: false } on subsequent calls
   */
  function simulateBootstrap(
    store: Map<string, { stage: string }>,
    dealId: string,
    stage: string = "intake",
  ): { ok: boolean; created: boolean } {
    if (store.has(dealId)) {
      // ON CONFLICT DO NOTHING
      return { ok: true, created: false };
    }
    store.set(dealId, { stage });
    return { ok: true, created: true };
  }

  test("first call creates deal_status", () => {
    const store = new Map<string, { stage: string }>();
    const result = simulateBootstrap(store, "deal-1");
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(store.get("deal-1")?.stage, "intake");
  });

  test("second call is idempotent — does not overwrite", () => {
    const store = new Map<string, { stage: string }>();
    simulateBootstrap(store, "deal-1");

    // Change stage to simulate lifecycle advancement
    store.set("deal-1", { stage: "underwriting" });

    // Second bootstrap call must NOT overwrite
    const result = simulateBootstrap(store, "deal-1");
    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.equal(store.get("deal-1")?.stage, "underwriting");
  });

  test("multiple deals can be bootstrapped independently", () => {
    const store = new Map<string, { stage: string }>();
    simulateBootstrap(store, "deal-1");
    simulateBootstrap(store, "deal-2");
    assert.equal(store.size, 2);
    assert.equal(store.get("deal-1")?.stage, "intake");
    assert.equal(store.get("deal-2")?.stage, "intake");
  });
});

// ─── 2. deriveCockpitPhase: BLOCKED is terminal ──────────────────────────────

describe("deriveCockpitPhase: BLOCKED is terminal", () => {
  /**
   * Mirrors the logic in usePrimaryCTA.ts deriveCockpitPhase().
   * The invariant: blockers ALWAYS take priority over processing spinner.
   */
  type ArtifactsSummary = {
    total_files: number;
    queued: number;
    processing: number;
    matched: number;
  };

  type LifecycleState = {
    blockers: Array<{ code: string; message: string }>;
    derived: { borrowerChecklistSatisfied: boolean };
  };

  type CockpitPhase = "UPLOADING" | "PROCESSING" | "READY" | "BLOCKED";

  function deriveCockpitPhase(
    artifactSummary: ArtifactsSummary | null,
    lifecycleState: LifecycleState | null,
  ): CockpitPhase {
    const totalFiles = artifactSummary?.total_files ?? 0;
    if (totalFiles === 0) return "UPLOADING";

    const queued = artifactSummary?.queued ?? 0;
    const processing = artifactSummary?.processing ?? 0;
    const activelyProcessing = queued > 0 || processing > 0;

    const hasBlockers = (lifecycleState?.blockers?.length ?? 0) > 0;
    if (hasBlockers) return "BLOCKED";

    if (activelyProcessing) return "PROCESSING";

    const allSatisfied = lifecycleState?.derived?.borrowerChecklistSatisfied ?? false;
    return allSatisfied ? "READY" : "BLOCKED";
  }

  test("no files → UPLOADING", () => {
    assert.equal(deriveCockpitPhase(null, null), "UPLOADING");
    assert.equal(
      deriveCockpitPhase({ total_files: 0, queued: 0, processing: 0, matched: 0 }, null),
      "UPLOADING",
    );
  });

  test("blockers present + processing → BLOCKED (not PROCESSING)", () => {
    const phase = deriveCockpitPhase(
      { total_files: 5, queued: 2, processing: 1, matched: 2 },
      {
        blockers: [{ code: "missing_required_docs", message: "2 docs missing" }],
        derived: { borrowerChecklistSatisfied: false },
      },
    );
    assert.equal(phase, "BLOCKED");
  });

  test("blockers present + no processing → BLOCKED", () => {
    const phase = deriveCockpitPhase(
      { total_files: 5, queued: 0, processing: 0, matched: 5 },
      {
        blockers: [{ code: "missing_required_docs", message: "1 doc missing" }],
        derived: { borrowerChecklistSatisfied: false },
      },
    );
    assert.equal(phase, "BLOCKED");
  });

  test("no blockers + processing → PROCESSING", () => {
    const phase = deriveCockpitPhase(
      { total_files: 5, queued: 1, processing: 0, matched: 4 },
      { blockers: [], derived: { borrowerChecklistSatisfied: false } },
    );
    assert.equal(phase, "PROCESSING");
  });

  test("no blockers + no processing + satisfied → READY", () => {
    const phase = deriveCockpitPhase(
      { total_files: 5, queued: 0, processing: 0, matched: 5 },
      { blockers: [], derived: { borrowerChecklistSatisfied: true } },
    );
    assert.equal(phase, "READY");
  });

  test("no blockers + no processing + not satisfied → BLOCKED", () => {
    const phase = deriveCockpitPhase(
      { total_files: 5, queued: 0, processing: 0, matched: 3 },
      { blockers: [], derived: { borrowerChecklistSatisfied: false } },
    );
    assert.equal(phase, "BLOCKED");
  });

  test("classified-but-unmatched does NOT count as processing", () => {
    // total_files > matched but queued=0, processing=0
    // This was the original bug — total_files > matched was incorrectly treated as processing
    const phase = deriveCockpitPhase(
      { total_files: 10, queued: 0, processing: 0, matched: 3 },
      { blockers: [], derived: { borrowerChecklistSatisfied: false } },
    );
    assert.equal(phase, "BLOCKED");
  });
});

// ─── 3. Naming trigger fires: maybeTriggerDealNaming guard logic ────────────

describe("maybeTriggerDealNaming guard logic", () => {
  /**
   * Mirrors pre-flight guard logic from maybeTriggerDealNaming.ts.
   * Tests the conditions under which naming should/shouldn't fire.
   *
   * IMPORTANT: Evidence docs only have ai_business_name and ai_borrower_name.
   * The non-existent entity_name column was removed — it caused PostgREST 400
   * errors that were silently swallowed as "no_classified_docs".
   */
  type Deal = {
    name_locked: boolean;
    naming_method: string | null;
    display_name: string | null;
  };

  type EvidenceDoc = {
    ai_business_name: string | null;
    ai_borrower_name: string | null;
  };

  function shouldTriggerNaming(
    deal: Deal,
    docs: EvidenceDoc[],
    queryError?: string,
  ): { triggered: boolean; reason: string } {
    if (deal.name_locked) return { triggered: false, reason: "name_locked" };
    if (deal.naming_method === "derived" && deal.display_name) {
      return { triggered: false, reason: "already_derived" };
    }
    if (deal.naming_method === "manual") {
      return { triggered: false, reason: "manual_override" };
    }

    // Query failure must NOT be masked as "no_classified_docs"
    if (queryError) return { triggered: false, reason: "evidence_query_failed" };

    if (docs.length === 0) return { triggered: false, reason: "no_classified_docs" };

    const hasEntityName = docs.some(
      (d) => d.ai_business_name || d.ai_borrower_name,
    );
    if (!hasEntityName) return { triggered: false, reason: "no_entity_names" };

    return { triggered: true, reason: "evidence_present" };
  }

  test("locked deal → does not trigger", () => {
    const result = shouldTriggerNaming(
      { name_locked: true, naming_method: null, display_name: null },
      [{ ai_business_name: "Acme Corp", ai_borrower_name: null }],
    );
    assert.equal(result.triggered, false);
    assert.equal(result.reason, "name_locked");
  });

  test("already derived → does not trigger", () => {
    const result = shouldTriggerNaming(
      { name_locked: false, naming_method: "derived", display_name: "Acme Corp" },
      [{ ai_business_name: "Acme Corp", ai_borrower_name: null }],
    );
    assert.equal(result.triggered, false);
    assert.equal(result.reason, "already_derived");
  });

  test("manual override → does not trigger", () => {
    const result = shouldTriggerNaming(
      { name_locked: false, naming_method: "manual", display_name: "My Deal" },
      [{ ai_business_name: "Acme", ai_borrower_name: null }],
    );
    assert.equal(result.triggered, false);
    assert.equal(result.reason, "manual_override");
  });

  test("no classified docs → does not trigger", () => {
    const result = shouldTriggerNaming(
      { name_locked: false, naming_method: null, display_name: null },
      [],
    );
    assert.equal(result.triggered, false);
    assert.equal(result.reason, "no_classified_docs");
  });

  test("classified docs but no entity names → does not trigger", () => {
    const result = shouldTriggerNaming(
      { name_locked: false, naming_method: null, display_name: null },
      [
        { ai_business_name: null, ai_borrower_name: null },
        { ai_business_name: null, ai_borrower_name: null },
      ],
    );
    assert.equal(result.triggered, false);
    assert.equal(result.reason, "no_entity_names");
  });

  test("classified docs with ai_business_name → TRIGGERS", () => {
    const result = shouldTriggerNaming(
      { name_locked: false, naming_method: null, display_name: null },
      [{ ai_business_name: "Acme Corp", ai_borrower_name: null }],
    );
    assert.equal(result.triggered, true);
    assert.equal(result.reason, "evidence_present");
  });

  test("ai_borrower_name field triggers naming", () => {
    const result = shouldTriggerNaming(
      { name_locked: false, naming_method: null, display_name: null },
      [{ ai_business_name: null, ai_borrower_name: "John Doe" }],
    );
    assert.equal(result.triggered, true);
  });

  test("query error → evidence_query_failed (NOT no_classified_docs)", () => {
    // This is the regression test for the entity_name column bug:
    // a PostgREST 400 from selecting a non-existent column was silently
    // swallowed as "no_classified_docs", preventing naming from ever firing.
    const result = shouldTriggerNaming(
      { name_locked: false, naming_method: null, display_name: null },
      [],
      "column deal_documents.entity_name does not exist",
    );
    assert.equal(result.triggered, false);
    assert.equal(result.reason, "evidence_query_failed");
    // MUST NOT be "no_classified_docs" — that masks the real error
    assert.notEqual(result.reason, "no_classified_docs");
  });
});

// ─── 3b. Document finalization pipeline ──────────────────────────────────────

describe("document finalization pipeline", () => {
  /**
   * Mirrors the finalization logic added to processArtifact and ingestDocument.
   *
   * Invariants:
   *   - Classification complete (document_type set) → finalized_at must be set
   *   - Manual override (match_source = "manual") → finalized_at must be set
   *   - Borrower task (match_source = "borrower_task") → finalized_at at ingest
   *   - Setting finalized_at is idempotent (only if currently null)
   *   - readiness: uploadsPending = count(finalized_at IS NULL)
   */
  type DocRow = {
    id: string;
    document_type: string | null;
    match_source: string | null;
    finalized_at: string | null;
    checklist_key: string | null;
  };

  /** Simulate the stamp + finalize in processArtifact */
  function stampAndFinalize(doc: DocRow, classification: { docType: string; confidence: number }): DocRow {
    // Manual override → skip AI, still finalize
    if (doc.match_source === "manual") {
      return {
        ...doc,
        finalized_at: doc.finalized_at ?? new Date().toISOString(),
      };
    }

    // AI classification stamp
    return {
      ...doc,
      document_type: classification.docType,
      match_source: "ai_classification",
      finalized_at: new Date().toISOString(),
    };
  }

  /** Simulate ingestDocument with borrower task */
  function ingestWithChecklistKey(checklistKey: string): DocRow {
    return {
      id: "doc-1",
      document_type: null,
      match_source: "borrower_task",
      finalized_at: new Date().toISOString(), // finalized at ingest
      checklist_key: checklistKey,
    };
  }

  /** Simulate readiness uploads-pending check */
  function countUploadsPending(docs: DocRow[]): number {
    return docs.filter((d) => d.finalized_at === null).length;
  }

  test("classification stamp sets finalized_at", () => {
    const doc: DocRow = {
      id: "doc-1",
      document_type: null,
      match_source: null,
      finalized_at: null,
      checklist_key: null,
    };
    const result = stampAndFinalize(doc, { docType: "BUSINESS_TAX_RETURN", confidence: 0.95 });
    assert.notEqual(result.finalized_at, null);
    assert.equal(result.document_type, "BUSINESS_TAX_RETURN");
  });

  test("manual override sets finalized_at", () => {
    const doc: DocRow = {
      id: "doc-1",
      document_type: "PFS",
      match_source: "manual",
      finalized_at: null,
      checklist_key: "PFS_CURRENT",
    };
    const result = stampAndFinalize(doc, { docType: "PFS", confidence: 1.0 });
    assert.notEqual(result.finalized_at, null);
  });

  test("idempotent: manual override does not overwrite existing finalized_at", () => {
    const original = "2024-01-15T00:00:00.000Z";
    const doc: DocRow = {
      id: "doc-1",
      document_type: "PFS",
      match_source: "manual",
      finalized_at: original,
      checklist_key: "PFS_CURRENT",
    };
    const result = stampAndFinalize(doc, { docType: "PFS", confidence: 1.0 });
    assert.equal(result.finalized_at, original);
  });

  test("borrower task ingest → finalized immediately", () => {
    const doc = ingestWithChecklistKey("IRS_1040_3Y");
    assert.notEqual(doc.finalized_at, null);
    assert.equal(doc.match_source, "borrower_task");
    assert.equal(doc.checklist_key, "IRS_1040_3Y");
  });

  test("readiness: unfinalized docs block readiness", () => {
    const docs: DocRow[] = [
      { id: "1", document_type: "PFS", match_source: "ai", finalized_at: "2024-01-01T00:00:00Z", checklist_key: null },
      { id: "2", document_type: null, match_source: null, finalized_at: null, checklist_key: null },
      { id: "3", document_type: "RENT_ROLL", match_source: "ai", finalized_at: "2024-01-01T00:00:00Z", checklist_key: null },
    ];
    assert.equal(countUploadsPending(docs), 1);
  });

  test("readiness: all finalized → 0 pending", () => {
    const docs: DocRow[] = [
      { id: "1", document_type: "PFS", match_source: "ai", finalized_at: "2024-01-01T00:00:00Z", checklist_key: null },
      { id: "2", document_type: "RENT_ROLL", match_source: "ai", finalized_at: "2024-01-02T00:00:00Z", checklist_key: null },
    ];
    assert.equal(countUploadsPending(docs), 0);
  });

  test("readiness: empty docs → 0 pending (not blocking)", () => {
    assert.equal(countUploadsPending([]), 0);
  });
});

// ─── 4. Year-based item guard for checklist ──────────────────────────────────

describe("year-based checklist item guard", () => {
  /**
   * Mirrors the isYearBasedItem logic from engine.ts.
   * Non-year items (PFS_CURRENT, AR_AP_AGING, BANK_STMT_3M, SBA_*)
   * must NEVER have satisfied_years populated.
   */
  function isYearBasedItem(checklistKey: string): boolean {
    // Year-based items: IRS_*_nY and FIN_STMT_*_nY
    const hasYearSuffix = /_\d+Y$/i.test(checklistKey);
    const isIrsYearItem = checklistKey.startsWith("IRS_") && hasYearSuffix;
    const isFinStmtYearItem = checklistKey.startsWith("FIN_STMT_") && hasYearSuffix;
    return isIrsYearItem || isFinStmtYearItem;
  }

  test("IRS_1040_3Y → year-based", () => {
    assert.equal(isYearBasedItem("IRS_1040_3Y"), true);
  });

  test("IRS_1120S_3Y → year-based", () => {
    assert.equal(isYearBasedItem("IRS_1120S_3Y"), true);
  });

  test("FIN_STMT_3Y → year-based", () => {
    assert.equal(isYearBasedItem("FIN_STMT_3Y"), true);
  });

  test("PFS_CURRENT → NOT year-based", () => {
    assert.equal(isYearBasedItem("PFS_CURRENT"), false);
  });

  test("AR_AP_AGING → NOT year-based", () => {
    assert.equal(isYearBasedItem("AR_AP_AGING"), false);
  });

  test("BANK_STMT_3M → NOT year-based", () => {
    assert.equal(isYearBasedItem("BANK_STMT_3M"), false);
  });

  test("SBA_FORM_1919 → NOT year-based", () => {
    assert.equal(isYearBasedItem("SBA_FORM_1919"), false);
  });

  test("SBA_FORM_912 → NOT year-based", () => {
    assert.equal(isYearBasedItem("SBA_FORM_912"), false);
  });
});

// ─── 5. Lifecycle stage mapping ──────────────────────────────────────────────

describe("lifecycle stage mapping", () => {
  /**
   * Tests that lifecycle stage mapping handles missing deal_status gracefully.
   * When deal_status is null, the stage should be derived from lifecycle_stage alone.
   */
  type DealLifecycleStage = "created" | "intake" | "collecting" | "underwriting" | "ready";
  type DealStatusStage = "intake" | "docs_in_progress" | "analysis" | "underwriting" | "conditional_approval" | "closing" | "funded" | "declined";

  function mapToUnifiedStage(
    lifecycleStage: DealLifecycleStage,
    dealStatusStage: DealStatusStage | null,
    borrowerChecklistSatisfied: boolean,
  ): string {
    // Terminal states from deal_status take priority
    if (dealStatusStage === "funded") return "closed";
    if (dealStatusStage === "closing") return "closing_in_progress";

    switch (lifecycleStage) {
      case "created":
        return "intake_created";
      case "intake":
        return "docs_requested";
      case "collecting":
        return borrowerChecklistSatisfied ? "docs_satisfied" : "docs_in_progress";
      case "underwriting":
        return "underwrite_in_progress";
      case "ready":
        return "committee_ready";
      default:
        return "intake_created";
    }
  }

  test("deal_status=null + lifecycle=created → intake_created (no blocker)", () => {
    const stage = mapToUnifiedStage("created", null, false);
    assert.equal(stage, "intake_created");
  });

  test("deal_status=null + lifecycle=collecting → docs_in_progress", () => {
    const stage = mapToUnifiedStage("collecting", null, false);
    assert.equal(stage, "docs_in_progress");
  });

  test("deal_status='funded' overrides lifecycle_stage", () => {
    const stage = mapToUnifiedStage("collecting", "funded", false);
    assert.equal(stage, "closed");
  });

  test("deal_status='closing' overrides lifecycle_stage", () => {
    const stage = mapToUnifiedStage("underwriting", "closing", false);
    assert.equal(stage, "closing_in_progress");
  });

  test("deal_status='intake' does not override lifecycle_stage", () => {
    // Non-terminal deal_status stages don't override
    const stage = mapToUnifiedStage("underwriting", "intake", false);
    assert.equal(stage, "underwrite_in_progress");
  });
});

// ─── 5b. Schema mismatch detection ──────────────────────────────────────────

describe("schema mismatch detection (safeFetch)", () => {
  /**
   * Mirrors isSchemaMismatchError from safeFetch.ts.
   * PostgREST errors from non-existent columns must be detected and
   * classified as schema_mismatch, NOT silently treated as "no data".
   */
  function isSchemaMismatchError(errorMsg: string): boolean {
    const msg = (errorMsg ?? "").toLowerCase();
    return (
      msg.includes("does not exist") ||
      (msg.includes("column") && msg.includes("not found")) ||
      (msg.includes("pgrst") && msg.includes("400")) ||
      (msg.includes("could not find") && msg.includes("column")) ||
      (msg.includes("relation") && msg.includes("does not exist"))
    );
  }

  test("detects 'column X does not exist'", () => {
    assert.equal(isSchemaMismatchError('column "entity_name" does not exist'), true);
  });

  test("detects PostgREST 400 error", () => {
    assert.equal(isSchemaMismatchError("PGRST: 400 Bad Request"), true);
  });

  test("detects 'could not find column'", () => {
    assert.equal(isSchemaMismatchError("Could not find column 'entity_name' in table"), true);
  });

  test("detects 'relation does not exist'", () => {
    assert.equal(isSchemaMismatchError('relation "deal_foo" does not exist'), true);
  });

  test("does NOT flag normal timeout errors", () => {
    assert.equal(isSchemaMismatchError("connection timed out"), false);
  });

  test("does NOT flag permission denied", () => {
    assert.equal(isSchemaMismatchError("permission denied for table deal_documents"), false);
  });

  test("does NOT flag empty string", () => {
    assert.equal(isSchemaMismatchError(""), false);
  });
});

// ─── 6. Route-level deal_not_found stripping ─────────────────────────────────

describe("lifecycle route: deal_not_found stripping when access confirmed", () => {
  /**
   * CRITICAL INVARIANT: If ensureDealBankAccess passed (deal exists + bank
   * matches), the lifecycle route must NEVER return deal_not_found blocker.
   *
   * A transient derivation failure (e.g., DB timeout during deal query inside
   * deriveLifecycleState) must NOT surface as deal_not_found to the client.
   */
  type Blocker = { code: string; message: string };

  function stripFalseNotFound(
    accessConfirmed: boolean,
    blockers: Blocker[],
  ): Blocker[] {
    if (accessConfirmed) {
      return blockers.filter((b) => b.code !== "deal_not_found");
    }
    return blockers;
  }

  test("strips deal_not_found when access check confirmed deal exists", () => {
    const blockers = stripFalseNotFound(true, [
      { code: "deal_not_found", message: "Deal not found or access denied" },
    ]);
    assert.equal(blockers.length, 0);
  });

  test("preserves deal_not_found when access check did NOT confirm", () => {
    const blockers = stripFalseNotFound(false, [
      { code: "deal_not_found", message: "Deal not found or access denied" },
    ]);
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].code, "deal_not_found");
  });

  test("preserves other blockers when stripping deal_not_found", () => {
    const blockers = stripFalseNotFound(true, [
      { code: "deal_not_found", message: "Deal not found" },
      { code: "missing_required_docs", message: "2 docs missing" },
      { code: "checklist_not_seeded", message: "No checklist" },
    ]);
    assert.equal(blockers.length, 2);
    assert.equal(blockers[0].code, "missing_required_docs");
    assert.equal(blockers[1].code, "checklist_not_seeded");
  });

  test("no-op when no deal_not_found blocker present", () => {
    const blockers = stripFalseNotFound(true, [
      { code: "missing_required_docs", message: "2 docs missing" },
    ]);
    assert.equal(blockers.length, 1);
  });
});
