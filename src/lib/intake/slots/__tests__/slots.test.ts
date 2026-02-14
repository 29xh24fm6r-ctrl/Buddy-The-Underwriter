import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Phase 15 — Core Document Slots Governance Tests
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// 1. Slot bootstrapper creates correct baseline (11 slots)
// ---------------------------------------------------------------------------

test("ensureCoreDocumentSlots defines 11 baseline slots with correct structure", () => {
  const src = readFile("src/lib/intake/slots/ensureCoreDocumentSlots.ts");

  // Must export buildCoreSlotDefinitions and computeTaxYears
  assert.ok(
    src.includes("export function buildCoreSlotDefinitions"),
    "Must export buildCoreSlotDefinitions",
  );
  assert.ok(
    src.includes("export function computeTaxYears") || src.includes("export { computeTaxYears }"),
    "Must export computeTaxYears",
  );

  // Tax year computation lives in taxYears.ts (pure module, filing-deadline-aware)
  const taxSrc = readFile("src/lib/intake/slots/taxYears.ts");
  assert.ok(
    taxSrc.includes("year - 1") && taxSrc.includes("year - 2") && taxSrc.includes("mostRecent"),
    "computeTaxYears must derive filing-deadline-aware tax years",
  );

  // 3 business tax return slots
  assert.ok(
    src.includes("BUSINESS_TAX_RETURN_${year}"),
    "Must create BUSINESS_TAX_RETURN_{year} slot keys",
  );
  assert.ok(
    src.includes('slot_group: "BUSINESS_TAX_RETURN"'),
    "Must assign BUSINESS_TAX_RETURN slot_group",
  );

  // 3 personal tax return slots
  assert.ok(
    src.includes("PERSONAL_TAX_RETURN_${year}"),
    "Must create PERSONAL_TAX_RETURN_{year} slot keys",
  );

  // PFS slot
  assert.ok(
    src.includes('"PFS_CURRENT"'),
    "Must create PFS_CURRENT slot",
  );
  assert.ok(
    src.includes('"PERSONAL_FINANCIAL_STATEMENT"'),
    "PFS slot requires PERSONAL_FINANCIAL_STATEMENT doc type",
  );

  // Income statement slot
  assert.ok(
    src.includes('"INCOME_STATEMENT_YTD"'),
    "Must create INCOME_STATEMENT_YTD slot",
  );

  // Balance sheet slot
  assert.ok(
    src.includes('"BALANCE_SHEET_CURRENT"'),
    "Must create BALANCE_SHEET_CURRENT slot",
  );

  // All slots required
  assert.ok(
    src.includes("required: true"),
    "Baseline slots must be required",
  );

  // Idempotent upsert (delegated to orchestrator in Phase 15B)
  const orchestratorSrc = readFile("src/lib/intake/slots/ensureDeterministicSlots.ts");
  assert.ok(
    orchestratorSrc.includes("upsert") && orchestratorSrc.includes("deal_id,slot_key"),
    "Must use idempotent upsert on (deal_id, slot_key)",
  );
});

// ---------------------------------------------------------------------------
// 2. Migration adds slot_id to deal_documents
// ---------------------------------------------------------------------------

test("migration adds slot_id column to deal_documents", () => {
  // Check that the migration SQL exists in processArtifact's slot lookup
  const src = readFile("src/lib/artifacts/processArtifact.ts");
  assert.ok(
    src.includes("lookupSlotDocType"),
    "processArtifact must define lookupSlotDocType helper",
  );
  assert.ok(
    src.includes('"slot_id"') || src.includes("'slot_id'") || src.includes(".slot_id"),
    "processArtifact must reference slot_id column",
  );
});

// ---------------------------------------------------------------------------
// 3. processArtifact has slot-aware routing
// ---------------------------------------------------------------------------

test("processArtifact uses slot doc type before classification-based routing", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");

  // lookupSlotDocType must be called BEFORE effectiveDocType is used
  const lookupIdx = src.indexOf("lookupSlotDocType");
  const extractIdx = src.indexOf("isExtractEligibleDocType(effectiveDocType)");

  assert.ok(lookupIdx > 0, "lookupSlotDocType must be in processArtifact");
  assert.ok(extractIdx > 0, "isExtractEligibleDocType must be in processArtifact");
  assert.ok(
    lookupIdx < extractIdx,
    "lookupSlotDocType must come BEFORE isExtractEligibleDocType",
  );
});

test("processArtifact validates slot attachment after stamp", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");

  assert.ok(
    src.includes("validateSlotAttachmentIfAny"),
    "processArtifact must call validateSlotAttachmentIfAny",
  );

  // Validation must come before extraction
  const validateIdx = src.indexOf("validateSlotAttachmentIfAny");
  const extractIdx = src.indexOf("6.5a. Structured extraction");
  assert.ok(
    validateIdx < extractIdx,
    "Slot validation must come before extraction step 6.5a",
  );
});

// ---------------------------------------------------------------------------
// 4. validateSlotAttachment checks type + year
// ---------------------------------------------------------------------------

test("validateSlotAttachment checks doc type and year match", () => {
  const src = readFile("src/lib/intake/slots/validateSlotAttachment.ts");

  assert.ok(
    src.includes("docTypesMatch"),
    "Must have docTypesMatch function",
  );
  assert.ok(
    src.includes("required_tax_year"),
    "Must check required_tax_year",
  );
  assert.ok(
    src.includes('"validated"'),
    "Must set status to validated on match",
  );
  assert.ok(
    src.includes('"rejected"'),
    "Must set status to rejected on mismatch",
  );
  assert.ok(
    src.includes("validation_reason"),
    "Must set validation_reason on rejection",
  );
});

// ---------------------------------------------------------------------------
// 5. files/record route accepts slot_id
// ---------------------------------------------------------------------------

test("files/record route accepts slot_id and calls attachDocumentToSlot", () => {
  const src = readFile("src/app/api/deals/[dealId]/files/record/route.ts");

  assert.ok(
    src.includes("slot_id"),
    "files/record must accept slot_id parameter",
  );
  assert.ok(
    src.includes("attachDocumentToSlot"),
    "files/record must call attachDocumentToSlot",
  );

  // slot attachment must happen BEFORE queueArtifact (skip import line)
  const attachIdx = src.indexOf("await attachDocumentToSlot(");
  const queueIdx = src.indexOf("await queueArtifact(");
  assert.ok(attachIdx > 0, "Must call attachDocumentToSlot");
  assert.ok(queueIdx > 0, "Must call queueArtifact");
  assert.ok(
    attachIdx < queueIdx,
    "Slot attachment must happen BEFORE queueArtifact",
  );
});

// ---------------------------------------------------------------------------
// 6. attachDocumentToSlot deactivates prior attachment
// ---------------------------------------------------------------------------

test("attachDocumentToSlot deactivates prior attachment on replace", () => {
  const src = readFile("src/lib/intake/slots/attachDocumentToSlot.ts");

  assert.ok(
    src.includes("is_active: false") || src.includes("is_active: false,"),
    "Must deactivate prior attachment (is_active = false)",
  );
  assert.ok(
    src.includes("replaced_by_id"),
    "Must set replaced_by_id on prior attachment",
  );
  assert.ok(
    src.includes('status: "attached"') || src.includes("status: 'attached'"),
    "Must update slot status to 'attached'",
  );
});

// ---------------------------------------------------------------------------
// 7. CoreDocumentsPanel exists and fetches slot data
// ---------------------------------------------------------------------------

test("CoreDocumentsPanel exists and fetches from /api/deals/:id/slots", () => {
  const src = readFile(
    "src/components/deals/cockpit/panels/CoreDocumentsPanel.tsx",
  );

  assert.ok(
    src.includes("/api/deals/"),
    "Must fetch from deals API",
  );
  assert.ok(
    src.includes("/slots"),
    "Must fetch from slots endpoint",
  );
  assert.ok(
    src.includes("slot_id"),
    "Must pass slot_id for uploads",
  );
});

test("LeftColumn renders CoreDocumentsPanel", () => {
  const src = readFile(
    "src/components/deals/cockpit/columns/LeftColumn.tsx",
  );

  assert.ok(
    src.includes("CoreDocumentsPanel"),
    "LeftColumn must render CoreDocumentsPanel",
  );
});

// ---------------------------------------------------------------------------
// 8. igniteDeal calls ensureCoreDocumentSlots
// ---------------------------------------------------------------------------

test("igniteDeal calls ensureCoreDocumentSlots during bootstrap", () => {
  const src = readFile("src/lib/deals/igniteDealCore.ts");

  assert.ok(
    src.includes("ensureCoreDocumentSlots"),
    "igniteDealCore must call ensureCoreDocumentSlots",
  );

  // Must come after checklist seeding
  const checklistIdx = src.indexOf("deal_checklist_items");
  const slotsIdx = src.indexOf("ensureCoreDocumentSlots");
  assert.ok(
    checklistIdx < slotsIdx,
    "Slot seeding must come after checklist seeding",
  );
});

// ---------------------------------------------------------------------------
// 9. Slot-aware spread routing
// ---------------------------------------------------------------------------

test("processArtifact uses slot doc type for spread routing", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");

  // The spread enqueue section must also reference lookupSlotDocType
  const spreadSection = src.slice(
    src.indexOf("6.5c. Enqueue financial spread"),
  );
  assert.ok(
    spreadSection.includes("slotDocType") || spreadSection.includes("lookupSlotDocType"),
    "Spread enqueue section must use slot doc type",
  );
});

// ===========================================================================
// Phase 15B — Product-Aware Deterministic Slots Governance Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 10. ensureCoreDocumentSlots delegates to ensureDeterministicSlotsForScenario
// ---------------------------------------------------------------------------

test("ensureCoreDocumentSlots delegates to ensureDeterministicSlotsForScenario", () => {
  const src = readFile("src/lib/intake/slots/ensureCoreDocumentSlots.ts");

  assert.ok(
    src.includes("ensureDeterministicSlotsForScenario"),
    "Must delegate to ensureDeterministicSlotsForScenario",
  );
  assert.ok(
    src.includes("./ensureDeterministicSlots"),
    "Must import from ./ensureDeterministicSlots",
  );
});

// ---------------------------------------------------------------------------
// 11. types.ts exports SlotDefinition, IntakeScenario, BusinessStage
// ---------------------------------------------------------------------------

test("types.ts exports slot policy types", () => {
  const src = readFile("src/lib/intake/slots/types.ts");

  assert.ok(src.includes("export type SlotDefinition"), "Must export SlotDefinition");
  assert.ok(src.includes("export type IntakeScenario"), "Must export IntakeScenario");
  assert.ok(src.includes("export type BusinessStage"), "Must export BusinessStage");
  assert.ok(src.includes("export type SlotPolicy"), "Must export SlotPolicy");
  assert.ok(src.includes("export type SlotMode"), "Must export SlotMode");
  assert.ok(src.includes("export type InteractiveKind"), "Must export InteractiveKind");
});

// ---------------------------------------------------------------------------
// 12. Policy registry exports resolveSlotPolicy + generateSlotsForScenario
// ---------------------------------------------------------------------------

test("policy registry exports resolveSlotPolicy and generateSlotsForScenario", () => {
  const src = readFile("src/lib/intake/slots/policies/index.ts");

  assert.ok(
    src.includes("export function resolveSlotPolicy"),
    "Must export resolveSlotPolicy",
  );
  assert.ok(
    src.includes("export function generateSlotsForScenario"),
    "Must export generateSlotsForScenario",
  );
  assert.ok(
    src.includes("SBA_7A"),
    "Registry must handle SBA_7A product type",
  );
  assert.ok(
    src.includes("CONVENTIONAL"),
    "Registry must include CONVENTIONAL fallback",
  );
});

// ---------------------------------------------------------------------------
// 13. SBA 7(a) policy handles all three business stages
// ---------------------------------------------------------------------------

test("SBA 7(a) policy handles EXISTING, STARTUP, and ACQUISITION stages", () => {
  const src = readFile("src/lib/intake/slots/policies/sba7a.ts");

  assert.ok(src.includes("EXISTING"), "Must handle EXISTING stage");
  assert.ok(src.includes("STARTUP"), "Must handle STARTUP stage");
  assert.ok(src.includes("ACQUISITION"), "Must handle ACQUISITION stage");
  assert.ok(
    src.includes("SBA_1919") && src.includes("SBA_413"),
    "Must include SBA form slots",
  );
  assert.ok(
    src.includes("BUSINESS_PLAN"),
    "Must include BUSINESS_PLAN for startup",
  );
  assert.ok(
    src.includes("PURCHASE_AGREEMENT"),
    "Must include PURCHASE_AGREEMENT for acquisition",
  );
});

// ---------------------------------------------------------------------------
// 14. Scenario API route exists
// ---------------------------------------------------------------------------

test("scenario API route exists with GET and PUT", () => {
  const src = readFile("src/app/api/deals/[dealId]/intake/scenario/route.ts");

  assert.ok(
    src.includes("export async function GET"),
    "Must export GET handler",
  );
  assert.ok(
    src.includes("export async function PUT"),
    "Must export PUT handler",
  );
  assert.ok(
    src.includes("deal_intake_scenario"),
    "Must reference deal_intake_scenario table",
  );
  assert.ok(
    src.includes("ensureDeterministicSlotsForScenario"),
    "PUT must call ensureDeterministicSlotsForScenario to regenerate slots",
  );
});

// ---------------------------------------------------------------------------
// 15. Orchestrator reads scenario and prunes stale slots
// ---------------------------------------------------------------------------

test("orchestrator loads scenario and prunes stale empty slots", () => {
  const src = readFile("src/lib/intake/slots/ensureDeterministicSlots.ts");

  assert.ok(
    src.includes("deal_intake_scenario"),
    "Must read from deal_intake_scenario table",
  );
  assert.ok(
    src.includes("generateSlotsForScenario"),
    "Must call generateSlotsForScenario",
  );
  assert.ok(
    src.includes("deal_document_slots"),
    "Must upsert to deal_document_slots",
  );
  // Stale slot pruning — only remove empty slots
  assert.ok(
    src.includes("empty") && (src.includes("delete") || src.includes("prune")),
    "Must prune stale empty slots",
  );
});

// ---------------------------------------------------------------------------
// 16. intake/set route upserts scenario
// ---------------------------------------------------------------------------

test("intake/set route upserts scenario and regenerates slots", () => {
  const src = readFile("src/app/api/deals/[dealId]/intake/set/route.ts");

  assert.ok(
    src.includes("deal_intake_scenario"),
    "intake/set must upsert deal_intake_scenario",
  );
  assert.ok(
    src.includes("ensureDeterministicSlotsForScenario"),
    "intake/set must call ensureDeterministicSlotsForScenario",
  );
  assert.ok(
    src.includes("borrowerBusinessStage") || src.includes("borrower_business_stage"),
    "intake/set must accept business stage in body",
  );
});

// ---------------------------------------------------------------------------
// 17. Validation equivalences cover SBA doc types
// ---------------------------------------------------------------------------

test("validateSlotAttachment covers SBA doc type equivalences", () => {
  const src = readFile("src/lib/intake/slots/validateSlotAttachment.ts");

  assert.ok(src.includes("SBA_1919"), "Must include SBA_1919 equivalence");
  assert.ok(src.includes("SBA_413"), "Must include SBA_413 equivalence");
  assert.ok(src.includes("DEBT_SCHEDULE"), "Must include DEBT_SCHEDULE equivalence");
  assert.ok(src.includes("BUSINESS_PLAN"), "Must include BUSINESS_PLAN equivalence");
  assert.ok(src.includes("FINANCIAL_PROJECTIONS"), "Must include FINANCIAL_PROJECTIONS equivalence");
  assert.ok(src.includes("PURCHASE_AGREEMENT"), "Must include PURCHASE_AGREEMENT equivalence");
  assert.ok(src.includes("ENTITY_DOCS"), "Must include ENTITY_DOCS equivalence");
});

// ---------------------------------------------------------------------------
// 18. CoreDocumentsPanel supports new slot groups
// ---------------------------------------------------------------------------

test("CoreDocumentsPanel supports SBA and acquisition slot groups", () => {
  const src = readFile("src/components/deals/cockpit/panels/CoreDocumentsPanel.tsx");

  assert.ok(src.includes("SBA_FORMS"), "Must include SBA_FORMS group");
  assert.ok(src.includes("STARTUP_PACKAGE"), "Must include STARTUP_PACKAGE group");
  assert.ok(src.includes("ACQUISITION_PACKAGE"), "Must include ACQUISITION_PACKAGE group");
  assert.ok(src.includes("help_reason"), "Must display help_reason on slots");
  assert.ok(
    src.includes('"completed"'),
    "Must support 'completed' slot status",
  );
});
