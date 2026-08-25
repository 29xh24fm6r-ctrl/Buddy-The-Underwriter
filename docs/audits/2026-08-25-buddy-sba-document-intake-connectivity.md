# Buddy SBA → Intake/Processing Engine Connectivity Audit

**Date:** 2026-08-25
**Scope:** Does the Buddy SBA document intake system connect end-to-end to Buddy the Underwriter's
document intake engine (classification / slots / matching) and processing engine
(OCR → extraction → `deal_financial_facts`)?
**Method:** Static trace of every SBA/borrower-facing document entry point through to the
underwriting engine's canonical tables and workers. No production data was queried.

---

## Verdict

**Partially connected.** The plumbing exists and the borrower's main upload path does reach the
engine. But the *SBA-specific* half of intake is not wired: a Buddy SBA deal never activates the
SBA slot policy or the SBA document checklist, generated SBA forms never enter the document
engine, and two secondary upload paths drop documents into a dead end where they are never
classified or extracted.

The single healthy link is financial facts: documents that do get processed land in
`deal_financial_facts`, and the SBA modules read that table — so extracted numbers do reach the
SBA package/assumptions layer.

| Link | State |
|---|---|
| Borrower portal upload → `deal_documents` | ✅ Connected |
| Borrower portal upload → OCR/classification | ✅ Connected (two different queues) |
| Banker confirm → processing → `deal_financial_facts` | ✅ Connected |
| Extracted facts → SBA package / assumptions | ✅ Connected |
| SBA deal → SBA slot policy (`SBA_1919`, `SBA_413`, `SBA_DEBT_SCHEDULE`) | ❌ Never activates |
| SBA deal → SBA document checklist (borrower + canonical) | ❌ Seeded as CRE |
| Generated SBA forms → `deal_documents` | ❌ No path |
| Intake documents → SBA package (tab 11) | ❌ No path |
| Public upload link → processing | ❌ Dead end |
| SBA e-Tran readiness → extracted revenue | ❌ Reads a key nothing writes |

---

## The engine, as built

Canonical ingestion is `src/lib/documents/ingestDocument.ts` → `deal_documents` (+ checklist
stamp + reconcile + ledger). Three separate processing queues sit downstream:

1. **`document_artifacts`** — `queueArtifact()` → `processArtifact()` (OCR, classify, stamp
   `canonical_type`). Drained by cron `/api/artifacts/process` every 5 min.
2. **`document_jobs`** (marked *legacy* at `src/app/api/jobs/worker/tick/route.ts:131`) —
   OCR → CLASSIFY → EXTRACT chain. Drained by cron `/api/jobs/worker/tick`.
3. **`buddy_outbox_events` kind `doc.extract`** — queued by `processConfirmedIntake` after
   banker confirmation. Drained by cron `/api/workers/doc-extraction`.

Slot policy resolution: `orchestrateIntake` → `ensureCoreDocumentSlots` →
`ensureDeterministicSlotsForScenario` → `loadIntakeScenario()` → `resolveSlotPolicy()`.
Post-confirmation, `processConfirmedIntake` → `runMatch` → `attachDocumentToSlot` fills the slots.

---

## Findings

### P0-1 — The SBA slot policy never activates for a Buddy SBA deal

`SBA_7A_POLICY` (`src/lib/intake/slots/policies/sba7a.ts`) defines the SBA-only slots —
`SBA_1919`, `SBA_413`, `SBA_DEBT_SCHEDULE` — plus EXISTING/STARTUP/ACQUISITION branches. It is
selected by `resolveSlotPolicy(scenario.product_type)` (`policies/index.ts:39`), and
`scenario` comes **only** from the `deal_intake_scenario` table
(`ensureDeterministicSlots.ts:21-41`). When that row is absent the code falls back to
`CONVENTIONAL_FALLBACK` (`ensureDeterministicSlots.ts:44-51`).

`deal_intake_scenario` has exactly two writers, both banker-side:
- `src/app/api/deals/[dealId]/intake/set/route.ts:200` — called only from `DealSetupCard.tsx:41`
  and `DealIntakeCard.tsx:352`
- `src/app/api/deals/[dealId]/intake/scenario/route.ts:109` — **no client caller in the codebase**

The production Buddy SBA deal is created at `src/lib/brokerage/conversionFunnel.ts:37` with
`deal_type: "SBA", origin: "brokerage_anonymous"` and nothing else. No scenario row is ever
written for it.

**Effect:** every borrower-originated SBA deal gets the 11 conventional slots. The SBA forms
slots are never created, so `runMatch` has nothing to attach an SBA 1919/413/debt schedule to,
and no surface can report them as missing.

### P0-2 — SBA deals are seeded with a CRE document checklist

`initializeIntake` (called from `/api/portal/[token]/files/record:146` and
`/api/portal/upload/commit:133`) reads `deal_intake.loan_type` and falls back to
`DEFAULT_LOAN_TYPE = "CRE"` (`initializeIntake.ts:15,76`). That value drives both
`buildChecklistForLoanType` → `deal_checklist_items` and `seedPortalChecklist` →
`deal_portal_checklist_items` (what the borrower actually sees).

Nothing in the borrower flow writes `deal_intake.loan_type`. The borrower flow instead writes:
- `deals.loan_type = "7a"` (`src/app/api/borrower/intake/progress/route.ts:389`)
- `borrower_applications.loan_type` (`src/app/api/borrower/portal/[token]/intake/route.ts:308`)

Neither is read by `initializeIntake`. And even if `deals.loan_type` were plumbed through,
`normalizeLoanTypeForChecklist("7a")` (`seedPortalChecklist.ts:73-79`) returns **`"CRE"`** —
`"7A"` is not in `KNOWN_LOAN_TYPES` and not among the `SBA`/`SBA7A`/`SBA504` aliases.

**Effect:** an SBA 7(a) borrower is asked for a CRE document set. `SBA_1919`, `SBA_413`,
`SBA_DEBT_SCHED`, `SBA_912` exist in `checklistPresets.ts:57-61` and their filename hints exist
in `seedPortalChecklist.ts:47-51` — they are simply never selected.

### P0-3 — Five fields, four vocabularies for "this is an SBA deal"

| Field | Written by | Value on a Buddy SBA deal | Read by |
|---|---|---|---|
| `deals.deal_type` | `conversionFunnel.ts:37` | `"SBA"` | `/api/deals/[dealId]/sba/route.ts:80,420` gate |
| `deals.product_type` | *(no production writer found)* | `NULL` | `dealProductType.isSBA()`, `borrowerFormsOrchestration.ts:65` |
| `deals.loan_type` | `borrower/intake/progress:389` | `"7a"` | nothing in the intake path |
| `deal_intake.loan_type` | `initializeIntake:76` | `"CRE"` (default) | both checklist seeders |
| `deal_intake_scenario.product_type` | banker routes only | *absent* | slot policy |

Two consequences beyond P0-1/P0-2:
- `isSBA(deal)` returns **false** for every production SBA deal, because it deliberately requires
  an explicit `product_type` (`dealProductType.ts:71-75`). Only the legacy
  `requiresSBAChecklist()` fallback keeps SBA behavior alive.
- `dealProductType.ts:9-11` states the rule "never read `deal_type` directly for that purpose",
  and `/api/deals/[dealId]/sba/route.ts:80,420` does exactly that.

The golden QA fixture (`trident/goldenTridentQaFixture.ts:89-90`) sets **both** `deal_type: "SBA"`
and `product_type: "SBA_7A"`, so tests exercise a shape production never produces.

### P1-1 — Public upload link is a processing dead end

`/api/public/upload/route.ts:272` calls `ingestDocument` and then never queues anything — no
`queueArtifact`, no `document_jobs` row. Same for `/api/portal/share/[action]/route.ts:115` and
`src/lib/builder/builderUploadCore.ts:353`.

Downstream this does not self-heal:
- `orchestrateIntake`'s `ensureDocumentClassification` only classifies documents that already have
  `document_ocr_results` text (`orchestrateIntake.ts:80-95`) — which requires OCR to have run.
- `processConfirmedIntake` queues extraction only for docs whose `canonical_type` is
  extract-eligible (`processConfirmedIntake.ts:549-551`); an unclassified doc has none.

**Effect:** a document uploaded through a public link sits in `deal_documents` forever with no OCR,
no `canonical_type`, and no extracted facts.

### P1-2 — Borrower entry points land in different queues

| Entry point | Ingest | Processing queue |
|---|---|---|
| `/api/portal/[token]/files/record` (guided intake dropzone) | `ingestDocument` | `queueArtifact` (artifacts) |
| `/api/portal/upload/commit` (portal UI) | `ingestDocument` | `document_jobs` OCR (**legacy**) |
| `/api/public/upload` (public link) | `ingestDocument` | none |
| `/api/portal/share/[action]` | `ingestDocument` | none |
| `/api/deals/[dealId]/files/record` (banker) | inline | `queueArtifact` + slot attach |
| conditions upload | `ingestDocument` | `queueArtifact` |

Two live pipelines with different classifiers, different retry/janitor semantics, and different
observability, chosen by which URL the borrower happened to hit.

### P1-3 — Generated SBA forms never enter the document engine

`src/lib/sba/**` contains **zero** references to `deal_documents` (verified by grep across
`src/lib/sba`, `src/lib/sbaForms`, `src/app/api/deals/[dealId]/sba`,
`src/app/api/portal/[token]/sba-forms`). Generated forms live at
`sba_package_run_items.output_storage_path` and are read back only by
`assembleTenTabPackage.ts:68`.

Two directions are both broken:
- **Forms → engine:** a completed SBA 1919/413 is invisible to the underwriter's document view,
  to the classifier, and to the `SBA_1919`/`SBA_413` slots the SBA policy defines as `UPLOAD`
  slots. Buddy generates the form and then still shows the slot as empty.
- **Engine → package:** `TEN_TAB_STRUCTURE` tab 11 is "Supporting Documents" with
  `templateCodes: []` (`tenTabAssembly.ts:32`), and `assembleTenTabPackage` only reads
  `sba_package_run_items`. Tax returns, financial statements, bank statements and entity docs
  collected by intake cannot be placed in the lender package.

### P1-4 — SBA e-Tran readiness reads a fact key nothing writes

`src/app/api/deals/[dealId]/sba/etran-readiness/route.ts:102` queries
`.eq("fact_key", "TOTAL_REVENUE_IS")`. Repo-wide, `TOTAL_REVENUE_IS` appears only in *readers* —
the extractors write `TOTAL_REVENUE` (`src/lib/financialSpreads/normalization/plAliases.ts:62`).

Peer modules already handle this: `sbaPackageOrchestrator.ts:142`, `sbaAssumptionsPrefill.ts:103`
and `sbaAssumptionDrafter.ts:42,151` all query `["TOTAL_REVENUE_IS", "TOTAL_REVENUE"]`.
`sbaAssumptionsPrefill.ts:98` even documents why. The e-Tran route is the one that does not, so
its revenue field is always null regardless of how completely documents were processed.

### P2-1 — Borrower checklist matches on filenames, not on classification

The borrower-facing checklist (`deal_portal_checklist_items` / `_state`) is marked "received" by
`applyReceiptToChecklist` matching the raw filename against `match_hints`
(`src/lib/portal/checklist.ts:67-76`). `/api/portal/[token]/files/record` calls it explicitly
"intentionally separate from canonical checklist reconciliation".

**Effect:** a file named `SBA-413.pdf` shows as received even if the classifier rejected it, and a
correctly classified `scan_0043.pdf` shows as missing. The borrower's completeness view and the
underwriter's can disagree with no reconciliation step.

### P2-2 — Slot attachment is banker-path only, pre-confirmation

`attachDocumentToSlot` is called from `/api/deals/[dealId]/files/record:981` and
`/api/deals/[dealId]/slots/route.ts:195`; no portal route calls it. Engine-side attachment does
happen later via `runGatekeeper` → `autoMatchDocToSlot` and `processConfirmedIntake` → `runMatch`
→ `attachDocumentToSlot`, so borrower documents are not orphaned — but they are matched against
the conventional slot set (P0-1), and even the banker path strips attachment pre-confirmation
(`files/record:891-910`).

---

## What is genuinely connected

Worth stating plainly, since most of the backbone is sound:

- `/api/portal/[token]/files/record` — the Buddy SBA guided-intake dropzone
  (`PortalUploadDropzone` → `uploadBorrowerFile` → `/files/sign` + `/files/record`) — runs the
  full canonical path: `ingestDocument` → `deal_documents` → checklist stamp + reconcile →
  `queueArtifact` → `processArtifact` (OCR + classify + `canonical_type`).
- Banker confirmation → `intake_outbox` → `runIntakeProcessing` → `processConfirmedIntake` →
  `queueDocExtractionOutbox` → `/api/workers/doc-extraction` → `extractFactsFromDocument` →
  `deal_financial_facts`. Fail-closed critical steps, heartbeats, stuck-detection and recovery
  workers are all present.
- SBA consumption of extracted facts works: `sbaPackageOrchestrator`, `sbaAssumptionsPrefill`,
  `sbaAssumptionDrafter` and `/api/deals/[dealId]/sba` all query `deal_financial_facts` by
  `fact_key` **without** filtering `fact_type`, so document-derived facts flow through alongside
  borrower-entered ones. This is the real SBA ↔ engine link.
- Condition uploads (`processConditionUpload.ts:54,113`) use ingest + queue correctly.

---

## Recommended remediation order

1. **Set the SBA scenario at deal creation.** Write `deal_intake_scenario`
   (`product_type: "SBA_7A"`, business stage from the concierge answers) when a Buddy SBA deal is
   created in `conversionFunnel.ts`, or derive it inside `loadIntakeScenario` from
   `deals.product_type` / `deals.deal_type` when the row is absent. Fixes P0-1.
2. **Collapse the loan-type vocabulary.** Make `deals.product_type` the single source, populate it
   at creation, backfill existing rows, and have `initializeIntake` derive `loan_type` from it.
   Add `"7A"` / `"7a"` to `normalizeLoanTypeForChecklist`. Fixes P0-2 and P0-3.
3. **Queue every ingest.** Move `queueArtifact` into `ingestDocument` itself so no caller can
   forget it; drop the bare-`ingestDocument` calls in `public/upload`, `portal/share` and
   `builderUploadCore`. Fixes P1-1 and P1-2 in one move.
4. **Register generated SBA forms as documents.** On `fill_run` completion, call `ingestDocument`
   with the form's `template_code` mapped to a canonical type so it satisfies the `SBA_1919` /
   `SBA_413` slots; and let tab 11 draw from `deal_documents`. Fixes P1-3.
5. **Add the `TOTAL_REVENUE` fallback** to the e-Tran readiness route. One-line fix for P1-4.
6. **Reconcile the borrower checklist against `canonical_type`** rather than filenames, or render
   the borrower view from the same slot/requirement state the underwriter sees. Fixes P2-1.

Items 1, 2 and 5 are small and unblock the SBA-specific behavior that is currently dormant.
Items 3 and 4 are the structural ones.
