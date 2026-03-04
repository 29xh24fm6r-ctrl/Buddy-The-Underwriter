/**
 * Atomic Checklist Hardening — CI Guards (Phases F–L)
 *
 * Structural invariants for the dual-layer checklist integrity system.
 * These guards CI-lock critical contracts that make "PFS uploaded but missing"
 * structurally impossible.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase F: Atomic Canonical-Type Update
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase F — Atomic Canonical-Type Update", () => {
  test("Guard 36a: resolve_checklist_key_sql mirrors TS resolveChecklistKey", () => {
    const sql = readSource(
      "supabase/migrations/20260304_atomic_checklist_hardening.sql",
    );
    const ts = readSource("src/lib/docTyping/resolveChecklistKey.ts");

    // All canonical types in the TS function must appear in the SQL mirror
    const canonicalTypes = [
      "PERSONAL_FINANCIAL_STATEMENT",
      "PERSONAL_TAX_RETURN",
      "BUSINESS_TAX_RETURN",
      "BALANCE_SHEET",
      "INCOME_STATEMENT",
      "RENT_ROLL",
      "BANK_STATEMENT",
    ];

    for (const ct of canonicalTypes) {
      assert.ok(
        sql.includes(ct),
        `SQL function must include canonical type: ${ct}`,
      );
      assert.ok(
        ts.includes(ct),
        `TS function must include canonical type: ${ct}`,
      );
    }

    // Verify the checklist_key outputs match (Phase P: FS types now have multiple keys)
    const keyMappings: Record<string, string> = {
      PFS_CURRENT: "PERSONAL_FINANCIAL_STATEMENT",
      IRS_PERSONAL_: "PERSONAL_TAX_RETURN",
      IRS_BUSINESS_: "BUSINESS_TAX_RETURN",
      FIN_STMT_BS_CURRENT: "BALANCE_SHEET",
      FIN_STMT_BS_HISTORICAL: "BALANCE_SHEET",
      FIN_STMT_PL_YTD: "INCOME_STATEMENT",
      FIN_STMT_PL_ANNUAL: "INCOME_STATEMENT",
      RENT_ROLL: "RENT_ROLL",
      BANK_STMT_3M: "BANK_STATEMENT",
    };

    for (const [key, type] of Object.entries(keyMappings)) {
      // SQL check: look in both the original and v2 migration files
      const sqlV2Src = readSource(
        "supabase/migrations/20260304_update_resolve_checklist_key_sql_v2.sql",
      );
      const inSql = sql.includes(key) || sqlV2Src.includes(key);
      assert.ok(
        inSql,
        `SQL must produce checklist_key '${key}' for ${type}`,
      );
      assert.ok(
        ts.includes(key),
        `TS must produce checklist_key '${key}' for ${type}`,
      );
    }
  });

  test("Guard 36b: atomic_retype_document RPC exists with correct signature", () => {
    const sql = readSource(
      "supabase/migrations/20260304_atomic_checklist_hardening.sql",
    );

    assert.ok(
      sql.includes("atomic_retype_document"),
      "atomic_retype_document function must exist",
    );
    assert.ok(
      sql.includes("p_document_id uuid"),
      "must accept p_document_id uuid",
    );
    assert.ok(
      sql.includes("p_new_canonical_type text"),
      "must accept p_new_canonical_type text",
    );
    assert.ok(
      sql.includes("FOR UPDATE"),
      "must lock document row (FOR UPDATE)",
    );
    assert.ok(
      sql.includes("reconcile_checklist_for_deal_sql"),
      "must call reconcile within the same transaction",
    );
  });

  test("Guard 36c: checklist-key route uses atomic_retype_document RPC", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts",
    );

    assert.ok(
      src.includes("atomic_retype_document"),
      "checklist-key route must call atomic_retype_document RPC",
    );
    assert.ok(
      src.includes("resolveChecklistKey"),
      "must still use resolveChecklistKey for response",
    );
  });

  test("Guard 36d: resolveChecklistKey is pure (no server-only deps)", () => {
    const src = readSource("src/lib/docTyping/resolveChecklistKey.ts");

    assert.ok(
      !src.includes('import "server-only"'),
      "resolveChecklistKey must be pure (no server-only)",
    );
    assert.ok(
      !src.includes("supabase"),
      "resolveChecklistKey must not import supabase",
    );
    assert.ok(
      !src.includes("process.env"),
      "resolveChecklistKey must not use process.env",
    );
  });

  test("Guard 36e: resolveChecklistKey produces correct output", async () => {
    const { resolveChecklistKey } = await import(
      "../../docTyping/resolveChecklistKey.js"
    );

    // Non-year/period-dependent types
    assert.equal(resolveChecklistKey("PERSONAL_FINANCIAL_STATEMENT", null), "PFS_CURRENT");
    assert.equal(resolveChecklistKey("RENT_ROLL", null), "RENT_ROLL");
    assert.equal(resolveChecklistKey("BANK_STATEMENT", null), "BANK_STMT_3M");

    // Period-dependent types (Phase P)
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null, "CURRENT"), "FIN_STMT_BS_CURRENT");
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null, "HISTORICAL"), "FIN_STMT_BS_HISTORICAL");
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null, "YTD"), "FIN_STMT_PL_YTD");
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null, "ANNUAL"), "FIN_STMT_PL_ANNUAL");

    // Period-dependent types WITHOUT period → null (Phase P)
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null), null);
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null), null);

    // Year-dependent types
    assert.equal(resolveChecklistKey("PERSONAL_TAX_RETURN", 2024), "IRS_PERSONAL_2024");
    assert.equal(resolveChecklistKey("BUSINESS_TAX_RETURN", 2023), "IRS_BUSINESS_2023");

    // Year-dependent types WITHOUT year → null
    assert.equal(resolveChecklistKey("PERSONAL_TAX_RETURN", null), null);
    assert.equal(resolveChecklistKey("BUSINESS_TAX_RETURN", null), null);

    // Unknown types → null
    assert.equal(resolveChecklistKey("DRIVERS_LICENSE", null), null);
    assert.equal(resolveChecklistKey("UNKNOWN", null), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase G: Checklist Mutability Guard
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase G — Checklist Mutability Guard", () => {
  // Allowlisted files that may set checklist_key directly.
  // Any new file that writes checklist_key MUST be added here with justification.
  const ALLOWLISTED_FILES = [
    // ── Phase F: Atomic RPC route ──
    "src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts",
    // ── Classification pipeline ──
    "src/lib/artifacts/processArtifact.ts",
    // ── Admin repair ──
    "src/app/api/admin/deals/[dealId]/repair/route.ts",
    // ── Best-effort matching (non-fatal, only if null) ──
    "src/app/(app)/deals/[dealId]/cockpit/seed/route.ts",
    "src/app/api/deals/[dealId]/files/auto-match-checklist/route.ts",
    "src/app/api/deals/[dealId]/files/record/route.ts",
    "src/app/api/deals/[dealId]/documents/intel/run/route.ts",
    "src/app/api/deals/[dealId]/intake/set/route.ts",
    // ── Checklist engine (reconciliation) ──
    "src/lib/checklist/engine.ts",
    // ── Doc typing (pure function definition) ──
    "src/lib/docTyping/resolveChecklistKey.ts",
    // ── Typing resolver ──
    "src/lib/docs/typing/resolveDocTyping.ts",
    // ── Upload helpers (pass-through metadata) ──
    "src/lib/uploads/commitUploadedFile.ts",
    "src/lib/uploads/parse.ts",
    "src/lib/uploads/types.ts",
    "src/lib/uploads/uploadFile.ts",
    // ── Document ingest (pass-through) ──
    "src/lib/documents/inferChecklistKey.ts",
    "src/lib/documents/ingestDocument.ts",
    // ── Checklist management routes (read/write checklist_items, not deal_documents) ──
    "src/app/api/deals/[dealId]/checklist/set-required/route.ts",
    "src/app/api/deals/[dealId]/checklist/set-status/route.ts",
    "src/app/api/deals/[dealId]/checklist/upsert/route.ts",
    // ── AI mapping persistence ──
    "src/lib/ai-docs/persistMapping.ts",
    // ── Portal upload routes (pass-through metadata) ──
    "src/app/api/portal/[token]/files/record/route.ts",
    "src/app/api/portal/upload/commit/route.ts",
    "src/app/api/public/upload/route.ts",
    // ── Builder upload core (pass-through) ──
    "src/lib/builder/builderUploadCore.ts",
    // ── Intake orchestration ──
    "src/lib/intake/orchestrateIntake.ts",
    // ── Type definitions ──
    "src/types/db.d.ts",
  ];

  test("Guard 36f: checklist_key only set in allowlisted files", () => {
    const srcRoot = path.join(process.cwd(), "src");

    // Recursively find all .ts files
    function walkTs(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".next") {
          files.push(...walkTs(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const allTsFiles = walkTs(srcRoot);
    const violations: string[] = [];

    // Patterns that indicate WRITING checklist_key (not just reading)
    const writePatterns = [
      /\.update\(\s*\{[^}]*checklist_key/,
      /checklist_key\s*[:=]\s*[^,}\n]*(?:resolveChecklistKey|matched|m\.matched|result\.matched|checklistKey|derivedKey)/,
    ];

    for (const filePath of allTsFiles) {
      const relPath = path.relative(process.cwd(), filePath);

      // Skip allowlisted files (normalize path separators for comparison)
      const normRel = relPath.replace(/\\/g, "/");
      if (ALLOWLISTED_FILES.some((allowed) => normRel === allowed || normRel.endsWith(allowed))) {
        continue;
      }

      // Skip test files (they reference checklist_key for assertions)
      if (relPath.includes("__tests__") || relPath.includes(".test.")) {
        continue;
      }

      const content = fs.readFileSync(filePath, "utf8");

      for (const pattern of writePatterns) {
        if (pattern.test(content)) {
          violations.push(`${relPath} matches pattern: ${pattern.source}`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `checklist_key write detected in non-allowlisted files:\n${violations.join("\n")}`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase H: Finalization Must Reconcile
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase H — Finalization Must Reconcile", () => {
  test("Guard 36g: finalize RPC calls reconcile_checklist_for_deal_sql", () => {
    const sql = readSource(
      "supabase/migrations/20260304_atomic_checklist_hardening.sql",
    );

    // The updated finalize_intake_and_enqueue_processing must include reconcile
    assert.ok(
      sql.includes("finalize_intake_and_enqueue_processing"),
      "migration must redefine finalize RPC",
    );

    // Check that reconcile is called within the finalize function body
    const finalizeBody = sql.substring(
      sql.indexOf("finalize_intake_and_enqueue_processing"),
    );
    assert.ok(
      finalizeBody.includes("reconcile_checklist_for_deal_sql"),
      "finalize RPC must call reconcile_checklist_for_deal_sql",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase I: Runtime Invariant Check
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase I — Runtime Invariant Check", () => {
  test("Guard 36h: reconcileChecklistForDeal contains invariant check", () => {
    const src = readSource("src/lib/checklist/engine.ts");

    assert.ok(
      src.includes("Invariant violation"),
      "reconcileChecklistForDeal must contain 'Invariant violation' throw",
    );
    assert.ok(
      src.includes("resolveChecklistKey"),
      "engine.ts must use resolveChecklistKey for invariant derivation",
    );
    assert.ok(
      src.includes("finalized_at"),
      "invariant check must reference finalized_at",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase J: NOT NULL Constraint for Finalized Docs
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase J — NOT NULL Constraint for Finalized Docs", () => {
  test("Guard 36i: finalized_docs_must_have_checklist_key constraint exists", () => {
    const sql = readSource(
      "supabase/migrations/20260304_atomic_checklist_hardening.sql",
    );

    assert.ok(
      sql.includes("finalized_docs_must_have_checklist_key"),
      "CHECK constraint finalized_docs_must_have_checklist_key must exist",
    );
    assert.ok(
      sql.includes("finalized_at IS NULL"),
      "constraint must allow non-finalized docs without checklist_key",
    );
    assert.ok(
      sql.includes("checklist_key IS NOT NULL"),
      "constraint must require checklist_key when conditions met",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase K: Canonical Type → Checklist Mapping Constraint
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase K — Canonical Type Mapping Constraint", () => {
  test("Guard 36j: requires_checklist_key function lists all mandatory types", () => {
    const sql = readSource(
      "supabase/migrations/20260304_atomic_checklist_hardening.sql",
    );

    assert.ok(
      sql.includes("requires_checklist_key"),
      "requires_checklist_key function must exist",
    );

    const mandatoryTypes = [
      "PERSONAL_FINANCIAL_STATEMENT",
      "BUSINESS_TAX_RETURN",
      "PERSONAL_TAX_RETURN",
      "BALANCE_SHEET",
      "INCOME_STATEMENT",
    ];

    for (const t of mandatoryTypes) {
      assert.ok(
        sql.includes(t),
        `requires_checklist_key must include: ${t}`,
      );
    }
  });

  test("Guard 36k: required_types_must_have_checklist_key constraint exists", () => {
    const sql = readSource(
      "supabase/migrations/20260304_atomic_checklist_hardening.sql",
    );

    assert.ok(
      sql.includes("required_types_must_have_checklist_key"),
      "CHECK constraint required_types_must_have_checklist_key must exist",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase L: Unique Checklist Pointer Integrity
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase L — Unique Checklist Pointer Integrity", () => {
  test("Guard 36l: unique_checklist_pointer index exists", () => {
    const sql = readSource(
      "supabase/migrations/20260304_atomic_checklist_hardening.sql",
    );

    assert.ok(
      sql.includes("unique_checklist_pointer"),
      "unique_checklist_pointer index must exist",
    );
    assert.ok(
      sql.includes("deal_checklist_items(deal_id, checklist_key)"),
      "index must cover (deal_id, checklist_key)",
    );
    assert.ok(
      sql.includes("received_document_id IS NOT NULL"),
      "index must be partial (WHERE received_document_id IS NOT NULL)",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-Phase: SQL ↔ TS Consistency
// ═══════════════════════════════════════════════════════════════════════════════

describe("Cross-Phase — SQL ↔ TS Consistency", () => {
  test("Guard 36m: SQL and TS checklist_key mappings produce identical results", async () => {
    const { resolveChecklistKey } = await import(
      "../../docTyping/resolveChecklistKey.js"
    );

    // These are the SQL function's expected outputs — verify TS matches
    // Phase P: now includes statement_period discriminator for FS types
    const cases: Array<{ type: string; year: number | null; period?: string | null; expected: string | null }> = [
      { type: "PERSONAL_FINANCIAL_STATEMENT", year: null, expected: "PFS_CURRENT" },
      { type: "PERSONAL_TAX_RETURN", year: 2024, expected: "IRS_PERSONAL_2024" },
      { type: "PERSONAL_TAX_RETURN", year: null, expected: null },
      { type: "BUSINESS_TAX_RETURN", year: 2023, expected: "IRS_BUSINESS_2023" },
      { type: "BUSINESS_TAX_RETURN", year: null, expected: null },
      { type: "BALANCE_SHEET", year: null, period: "CURRENT", expected: "FIN_STMT_BS_CURRENT" },
      { type: "BALANCE_SHEET", year: null, period: "HISTORICAL", expected: "FIN_STMT_BS_HISTORICAL" },
      { type: "BALANCE_SHEET", year: null, expected: null },
      { type: "INCOME_STATEMENT", year: null, period: "YTD", expected: "FIN_STMT_PL_YTD" },
      { type: "INCOME_STATEMENT", year: null, period: "ANNUAL", expected: "FIN_STMT_PL_ANNUAL" },
      { type: "INCOME_STATEMENT", year: null, expected: null },
      { type: "RENT_ROLL", year: null, expected: "RENT_ROLL" },
      { type: "BANK_STATEMENT", year: null, expected: "BANK_STMT_3M" },
      { type: "DRIVERS_LICENSE", year: null, expected: null },
      { type: "W2", year: 2024, expected: null },
    ];

    for (const { type, year, period, expected } of cases) {
      const result = resolveChecklistKey(type, year, period);
      assert.equal(
        result,
        expected,
        `resolveChecklistKey("${type}", ${year}, ${period ?? "null"}) should be ${expected}, got ${result}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase M: Per-Doc Confirm Must Derive checklist_key (No Client Input)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase M — Per-Doc Confirm Derives checklist_key", () => {
  const CONFIRM_ROUTE = "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts";

  test("Guard M-37: Per-doc confirm route must NOT accept checklist_key from client", () => {
    const src = readSource(CONFIRM_ROUTE);

    // BodySchema must not contain checklist_key
    // Extract just the BodySchema definition to avoid false positives from comments/afterState
    const schemaMatch = src.match(/const BodySchema\s*=\s*z\.object\(\{[\s\S]*?\}\)/);
    assert.ok(schemaMatch, "BodySchema must exist");
    const schemaBody = schemaMatch![0];
    assert.ok(
      !schemaBody.includes("checklist_key"),
      "Guard M-37: BodySchema must NOT contain checklist_key — it is a DERIVED field",
    );

    // No body.checklist_key assignment
    assert.ok(
      !src.includes("body.checklist_key"),
      "Guard M-37: Route must NOT reference body.checklist_key",
    );

    // No patch.checklist_key = body.checklist_key
    assert.ok(
      !src.includes("patch.checklist_key = body.checklist_key"),
      "Guard M-37: Route must NOT set patch.checklist_key from body",
    );
  });

  test("Guard M-38: Per-doc confirm must derive checklist_key via resolveChecklistKey", () => {
    const src = readSource(CONFIRM_ROUTE);

    assert.ok(
      src.includes("resolveChecklistKey"),
      "Guard M-38: Route must import and call resolveChecklistKey",
    );

    assert.ok(
      src.includes("derivedChecklistKey"),
      "Guard M-38: Route must use derivedChecklistKey variable",
    );

    assert.ok(
      src.includes("patch.checklist_key = derivedChecklistKey"),
      "Guard M-38: Route must stamp patch.checklist_key from derivation",
    );
  });

  test("Guard M-39: Per-doc confirm must fail with 400 when derivation fails for required types", () => {
    const src = readSource(CONFIRM_ROUTE);

    assert.ok(
      src.includes("invalid_checklist_derivation"),
      "Guard M-39: Route must return invalid_checklist_derivation error",
    );

    assert.ok(
      src.includes("status: 400"),
      "Guard M-39: Derivation failure must be a 400 (actionable), not 500",
    );
  });

  test("Guard M-40: Per-doc confirm uses atomic_retype_document for type changes", () => {
    const src = readSource(CONFIRM_ROUTE);

    assert.ok(
      src.includes("atomic_retype_document"),
      "Guard M-40: Route must call atomic_retype_document RPC for canonical_type changes",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase N: Confirm Endpoint Idempotency
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase N — Confirm Endpoint Idempotency", () => {
  const CONFIRM_ROUTE = "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts";

  test("Guard N-41: Confirm route must have idempotency guard for already-confirmed docs", () => {
    const src = readSource(CONFIRM_ROUTE);

    assert.ok(
      src.includes("alreadyConfirmed") && src.includes("requestMatchesCurrent"),
      "Guard N-41: Route must check if doc is already USER_CONFIRMED with matching fields",
    );
  });

  test("Guard N-42: Idempotent re-confirm returns noop: true", () => {
    const src = readSource(CONFIRM_ROUTE);

    assert.ok(
      src.includes("noop: true"),
      "Guard N-42: Idempotent re-confirm must return noop: true in response",
    );
  });

  test("Guard N-43: Idempotent re-confirm must NOT re-stamp intake_confirmed_at", () => {
    const src = readSource(CONFIRM_ROUTE);

    // The noop return must come BEFORE the patch construction
    const noopIdx = src.indexOf("noop: true");
    const patchIdx = src.indexOf("intake_confirmed_at: now");
    assert.ok(
      noopIdx > 0 && patchIdx > 0 && noopIdx < patchIdx,
      "Guard N-43: Idempotent noop return must precede patch construction to avoid re-stamping",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase O: Year-Required UI Gate for Tax Returns
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase O — Year-Required UI Gate", () => {
  const REVIEW_TABLE = "src/components/deals/intake/IntakeReviewTable.tsx";

  test("Guard O-44: IntakeReviewTable must define YEAR_REQUIRED_TYPES", () => {
    const src = readSource(REVIEW_TABLE);

    assert.ok(
      src.includes("YEAR_REQUIRED_TYPES"),
      "Guard O-44: IntakeReviewTable must define YEAR_REQUIRED_TYPES constant",
    );
  });

  test("Guard O-45: YEAR_REQUIRED_TYPES must include PTR and BTR", () => {
    const src = readSource(REVIEW_TABLE);

    assert.ok(
      src.includes('"PERSONAL_TAX_RETURN"') && src.includes('"BUSINESS_TAX_RETURN"'),
      "Guard O-45: YEAR_REQUIRED_TYPES must include both PERSONAL_TAX_RETURN and BUSINESS_TAX_RETURN",
    );
  });

  test("Guard O-46: Save button must be disabled when year/period-required type has missing field", () => {
    const src = readSource(REVIEW_TABLE);

    assert.ok(
      src.includes("YEAR_REQUIRED_TYPES.has(") &&
      src.includes("PERIOD_REQUIRED_TYPES.has(") &&
      src.includes("disabled={blocked}"),
      "Guard O-46: Save button must check both YEAR_REQUIRED_TYPES and PERIOD_REQUIRED_TYPES and disable when missing",
    );
  });

  test("Guard O-47: Confirm button must be disabled when year/period-required type has missing field", () => {
    const src = readSource(REVIEW_TABLE);

    assert.ok(
      src.includes("YEAR_REQUIRED_TYPES.has(docType)") &&
      src.includes("PERIOD_REQUIRED_TYPES.has(docType)") &&
      src.includes("cursor-not-allowed"),
      "Guard O-47: Confirm button must check both YEAR_REQUIRED_TYPES and PERIOD_REQUIRED_TYPES against doc",
    );
  });

  test("Guard O-48: Server-side confirm route must reject types missing required discriminators", () => {
    const confirmSrc = readSource(
      "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
    );

    assert.ok(
      confirmSrc.includes("invalid_checklist_derivation") &&
      confirmSrc.includes("PERIOD_REQUIRED_TYPES") &&
      confirmSrc.includes("statement_period"),
      "Guard O-48: Server confirm route must return 400 for missing year OR missing statement_period",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase P: Deterministic Financial Statement Keys
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase P — Deterministic Financial Statement Keys", () => {
  const CONFIRM_ROUTE = "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts";
  const REVIEW_TABLE = "src/components/deals/intake/IntakeReviewTable.tsx";

  test("Guard P-49: resolveChecklistKey returns null for IS without statement_period", async () => {
    const { resolveChecklistKey } = await import(
      "../../docTyping/resolveChecklistKey.js"
    );
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null), null);
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null, null), null);
  });

  test("Guard P-50: resolveChecklistKey returns null for BS without statement_period", async () => {
    const { resolveChecklistKey } = await import(
      "../../docTyping/resolveChecklistKey.js"
    );
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null), null);
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null, null), null);
  });

  test("Guard P-51: resolveChecklistKey returns distinct keys for IS YTD vs ANNUAL", async () => {
    const { resolveChecklistKey } = await import(
      "../../docTyping/resolveChecklistKey.js"
    );
    const ytd = resolveChecklistKey("INCOME_STATEMENT", null, "YTD");
    const annual = resolveChecklistKey("INCOME_STATEMENT", null, "ANNUAL");
    assert.ok(ytd && annual && ytd !== annual,
      "Guard P-51: IS YTD and ANNUAL must resolve to different keys",
    );
  });

  test("Guard P-52: resolveChecklistKey returns distinct keys for BS CURRENT vs HISTORICAL", async () => {
    const { resolveChecklistKey } = await import(
      "../../docTyping/resolveChecklistKey.js"
    );
    const current = resolveChecklistKey("BALANCE_SHEET", null, "CURRENT");
    const historical = resolveChecklistKey("BALANCE_SHEET", null, "HISTORICAL");
    assert.ok(current && historical && current !== historical,
      "Guard P-52: BS CURRENT and HISTORICAL must resolve to different keys",
    );
  });

  test("Guard P-53: Confirm route accepts statement_period in body schema", () => {
    const src = readSource(CONFIRM_ROUTE);
    assert.ok(
      src.includes('statement_period: z.enum('),
      "Guard P-53: BodySchema must accept statement_period with z.enum validation",
    );
  });

  test("Guard P-54: Confirm route passes statement_period to resolveChecklistKey", () => {
    const src = readSource(CONFIRM_ROUTE);
    assert.ok(
      src.includes("effectiveStatementPeriod") &&
      src.includes("resolveChecklistKey(effectiveCanonicalType, effectiveTaxYear, effectiveStatementPeriod)"),
      "Guard P-54: Route must derive effectiveStatementPeriod and pass to resolveChecklistKey",
    );
  });

  test("Guard P-55: UI defines PERIOD_REQUIRED_TYPES for IS and BS", () => {
    const src = readSource(REVIEW_TABLE);
    assert.ok(
      src.includes("PERIOD_REQUIRED_TYPES") &&
      src.includes('"INCOME_STATEMENT"') &&
      src.includes('"BALANCE_SHEET"'),
      "Guard P-55: UI must define PERIOD_REQUIRED_TYPES with IS and BS",
    );
  });

  test("Guard P-56: UI shows period dropdown for IS/BS in edit mode", () => {
    const src = readSource(REVIEW_TABLE);
    assert.ok(
      src.includes("PERIOD_REQUIRED_TYPES.has(editValues.canonical_type") &&
      src.includes('statement_period') &&
      src.includes('"YTD"') && src.includes('"ANNUAL"') &&
      src.includes('"Current"') && src.includes('"Historical"'),
      "Guard P-56: UI must show period dropdown with correct options for IS and BS",
    );
  });

  test("Guard P-57: PERIOD_REQUIRED_TYPES exported from resolveChecklistKey module", () => {
    const src = readSource("src/lib/docTyping/resolveChecklistKey.ts");
    assert.ok(
      src.includes("export const PERIOD_REQUIRED_TYPES"),
      "Guard P-57: PERIOD_REQUIRED_TYPES must be exported for reuse",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase Q: Canonical Doc Retyped Ledger Event With Full Diff
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase Q — Canonical Diff Event", () => {
  const CONFIRM_ROUTE = "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts";

  test("Guard Q-58: Corrected event includes before + after objects", () => {
    const src = readSource(CONFIRM_ROUTE);
    assert.ok(
      src.includes("before: beforeState") && src.includes("after: afterState"),
      "Guard Q-58: intake.document_corrected event must include before and after state",
    );
  });

  test("Guard Q-59: Event payload includes derived_checklist_key", () => {
    const src = readSource(CONFIRM_ROUTE);
    assert.ok(
      src.includes("derived_checklist_key: derivedChecklistKey"),
      "Guard Q-59: Event payload must include derived_checklist_key",
    );
  });

  test("Guard Q-60: Event payload includes source field", () => {
    const src = readSource(CONFIRM_ROUTE);
    assert.ok(
      src.includes('source: "intake_review_confirm"'),
      "Guard Q-60: Event payload must include source: intake_review_confirm",
    );
  });

  test("Guard Q-61: beforeState and afterState include statement_period", () => {
    const src = readSource(CONFIRM_ROUTE);

    const beforeBlock = src.slice(src.indexOf("const beforeState"), src.indexOf("const beforeState") + 500);
    const afterBlock = src.slice(src.indexOf("const afterState"), src.indexOf("const afterState") + 500);

    assert.ok(
      beforeBlock.includes("statement_period") && afterBlock.includes("statement_period"),
      "Guard Q-61: Both beforeState and afterState must include statement_period for full diff",
    );
  });

  test("Guard Q-62: No event emitted on noop (Phase N idempotency)", () => {
    const src = readSource(CONFIRM_ROUTE);

    const noopIdx = src.indexOf("noop: true");
    const firstEventIdx = src.indexOf("intake.document_finalized");
    assert.ok(
      noopIdx > 0 && firstEventIdx > 0 && noopIdx < firstEventIdx,
      "Guard Q-62: Noop return must precede all event emissions — no events on idempotent re-confirm",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase R: Post-Confirm Self-Heal Reconcile
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase R — Post-Confirm Reconcile", () => {
  const CONFIRM_ROUTE = "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts";

  test("Guard R-63: Confirm path calls reconcileChecklistForDeal after update", () => {
    const src = readSource(CONFIRM_ROUTE);
    assert.ok(
      src.includes("reconcileChecklistForDeal"),
      "Guard R-63: Confirm route must call reconcileChecklistForDeal after document update",
    );
  });

  test("Guard R-64: Reconcile emits checklist.reconciled event", () => {
    const src = readSource(CONFIRM_ROUTE);
    assert.ok(
      src.includes('"checklist.reconciled"'),
      "Guard R-64: Post-confirm reconcile must emit checklist.reconciled event",
    );
  });

  test("Guard R-65: Reconcile is non-blocking (reconcile failure does not block confirmation)", () => {
    const src = readSource(CONFIRM_ROUTE);

    // The reconcile block must contain "Non-blocking" or similar comment + catch block
    assert.ok(
      src.includes("reconcileChecklistForDeal") &&
      src.includes("reconcile failed") &&
      src.includes("} catch (reconcileErr"),
      "Guard R-65: Reconcile must be wrapped in try-catch — failure must not block confirmation",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase S: Multi-Entity Bind Slots (Infrastructure Verification)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase S — Entity Slot Binding Infrastructure", () => {
  test("Guard S-66: IntakeReviewTable surfaces entity_binding_required state", () => {
    const src = readSource("src/components/deals/intake/IntakeReviewTable.tsx");
    assert.ok(
      src.includes("entityBindingRequired") && src.includes("setEntityBindingRequired"),
      "Guard S-66: UI must track entityBindingRequired state from processing-status",
    );
  });

  test("Guard S-67: IntakeReviewTable shows Bind Slots CTA when entity binding required", () => {
    const src = readSource("src/components/deals/intake/IntakeReviewTable.tsx");
    assert.ok(
      src.includes("Bind Slots") && src.includes("entityBindingRequired"),
      "Guard S-67: UI must show 'Bind Slots' CTA when entityBindingRequired is true",
    );
  });

  test("Guard S-68: confirm-attribution endpoint exists for entity slot binding", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/identity/confirm-attribution/route.ts",
    );
    assert.ok(
      src.includes("slot.entity_manual_confirm") &&
      src.includes("required_entity_id"),
      "Guard S-68: confirm-attribution endpoint must set required_entity_id and emit slot.entity_manual_confirm",
    );
  });

  test("Guard S-69: runMatch hard-stops auto-attach into unbound entity-scoped slots", () => {
    const src = readSource("src/lib/intake/matching/runMatch.ts");
    assert.ok(
      src.includes("entity_binding_required") &&
      src.includes("ENTITY_SCOPED_DOC_TYPES"),
      "Guard S-69: runMatch must filter unbound entity-scoped slots and route to review",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase S (cont.) — Entity Slot Binding Page & Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

describe("Phase S (cont.) — Entity Slot Binding Page", () => {
  test("Guard S-70: intake/slots page.tsx exists and renders EntitySlotBindingPage", () => {
    const src = readSource(
      "src/app/(app)/deals/[dealId]/intake/slots/page.tsx",
    );
    assert.ok(
      src.includes("EntitySlotBindingPage") &&
      src.includes("ensureDealBankAccess"),
      "Guard S-70: page.tsx must render EntitySlotBindingPage with auth guard",
    );
  });

  test("Guard S-71: IntakeReviewTable CTA links to /intake/slots", () => {
    const src = readSource("src/components/deals/intake/IntakeReviewTable.tsx");
    assert.ok(
      src.includes("/intake/slots") &&
      src.includes("Bind Slots"),
      "Guard S-71: CTA must link to /intake/slots and say 'Bind Slots'",
    );
  });

  test("Guard S-72: bind-slots endpoint enforces entity-scoped validation", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/bind-slots/route.ts",
    );
    assert.ok(
      src.includes("ENTITY_SCOPED_DOC_TYPES") &&
      src.includes("not entity-scoped"),
      "Guard S-72: bind-slots must validate slots are entity-scoped using ENTITY_SCOPED_DOC_TYPES",
    );
  });

  test("Guard S-73: bind-slots endpoint emits slot.entity_bound events", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/bind-slots/route.ts",
    );
    assert.ok(
      src.includes("slot.entity_bound") &&
      src.includes("writeEvent"),
      "Guard S-73: bind-slots must emit slot.entity_bound ledger events",
    );
  });

  test("Guard S-74: entity-slot-bindings endpoint returns unbound_count", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/entity-slot-bindings/route.ts",
    );
    assert.ok(
      src.includes("unbound_count") &&
      src.includes("entity_binding_required") &&
      src.includes("ENTITY_SCOPED_DOC_TYPES"),
      "Guard S-74: entity-slot-bindings must return unbound_count and entity_binding_required",
    );
  });
});
