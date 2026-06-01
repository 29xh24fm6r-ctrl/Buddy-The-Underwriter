// SPEC-MEMO-READINESS-WIRE-1
//
// Structural guard: ensures the memo input reader queries the exact UPPERCASE
// canonical fact keys defined in the CANONICAL_FACTS registry. If a future
// edit reintroduces lowercase strings or hardcodes any key string, this test
// fails CI before the bug ships.
//
// Pure source-grep guard — no runtime imports from server-only modules.
// Runner: node --test --import tsx (per package.json scripts test:unit).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const READER_PATH = resolve(
  process.cwd(),
  "src/lib/creditMemo/inputs/buildMemoInputPackage.ts",
);

const REGISTRY_PATH = resolve(
  process.cwd(),
  "src/lib/financialFacts/keys.ts",
);

test("loadRequiredFinancialFacts sources keys from CANONICAL_FACTS registry", () => {
  const src = readFileSync(READER_PATH, "utf8");

  // Must import the registry — not hardcode key strings.
  assert.match(
    src,
    /import\s*\{[^}]*\bCANONICAL_FACTS\b[^}]*\}\s*from\s*["']@\/lib\/financialFacts\/keys["']/,
    "buildMemoInputPackage.ts must import CANONICAL_FACTS",
  );

  // Must use CANONICAL_FACTS.<KEY>.fact_key for the registry-sourced facts.
  // Each of these substrings is sufficient evidence that the reader is
  // parameterised by the registry rather than a hardcoded string literal.
  for (const ref of [
    "CANONICAL_FACTS.DSCR.fact_key",
    "CANONICAL_FACTS.ANNUAL_DEBT_SERVICE.fact_key",
    "CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_key",
  ]) {
    assert.ok(
      src.includes(ref),
      `buildMemoInputPackage.ts must reference ${ref}`,
    );
  }

  // SPEC-GCF-SOURCE-OF-TRUTH-1: GCF now goes through the canonical fact-key
  // contract (GCF_GLOBAL_CASH_FLOW preferred, GLOBAL_CASH_FLOW legacy fallback)
  // via resolveGcfFactValue — NOT the bare legacy registry key. This keeps
  // readiness in agreement with the credit memo / snapshot.
  assert.ok(
    src.includes("resolveGcfFactValue"),
    "buildMemoInputPackage.ts must resolve GCF through the canonical contract",
  );
  assert.ok(
    /globalCashFlow:\s*GCF_CANONICAL_FACT_KEY/.test(src),
    "GCF must key on the canonical GCF_GLOBAL_CASH_FLOW (via GCF_CANONICAL_FACT_KEY)",
  );
  assert.ok(
    !/globalCashFlow:\s*CANONICAL_FACTS\.GLOBAL_CASH_FLOW\.fact_key/.test(src),
    "GCF must no longer read ONLY the legacy GLOBAL_CASH_FLOW registry key",
  );

  // Must NOT hardcode lowercase fact keys in an .in() clause for fact_key.
  // This rejects the regression: .in("fact_key", ["dscr", ...]).
  const lowercaseInClause = /\.in\(\s*["']fact_key["']\s*,\s*\[[^\]]*["']dscr["']/;
  assert.ok(
    !lowercaseInClause.test(src),
    `buildMemoInputPackage.ts must not query fact_key with lowercase "dscr" — found regression of SPEC-MEMO-READINESS-WIRE-1`,
  );
});

test("CANONICAL_FACTS registry has the four required entries with uppercase fact_keys", () => {
  // Source-grep the registry file directly (keys.ts imports server-only,
  // so we cannot runtime-import it in CI guard tests).
  const src = readFileSync(REGISTRY_PATH, "utf8");

  for (const key of ["DSCR", "ANNUAL_DEBT_SERVICE", "GLOBAL_CASH_FLOW", "BANK_LOAN_TOTAL"]) {
    // Each entry must have fact_key: "KEY" (uppercase, matching canonical_key).
    const pattern = new RegExp(`${key}:\\s*\\{[^}]*fact_key:\\s*["']${key}["']`);
    assert.ok(
      pattern.test(src),
      `CANONICAL_FACTS registry must define ${key} with fact_key: "${key}"`,
    );
  }
});

test("canonical GCF key constant matches the registry (no drift)", () => {
  // The pure selector defines GCF_CANONICAL_FACT_KEY; it must equal the
  // registry's GCF_GLOBAL_CASH_FLOW.fact_key so the contract can't silently drift.
  const core = readFileSync(
    resolve(process.cwd(), "src/lib/financialFacts/canonicalGcfCore.ts"),
    "utf8",
  );
  const registry = readFileSync(REGISTRY_PATH, "utf8");
  assert.match(
    core,
    /GCF_CANONICAL_FACT_KEY\s*=\s*["']GCF_GLOBAL_CASH_FLOW["']/,
    "canonical GCF key constant must be GCF_GLOBAL_CASH_FLOW",
  );
  assert.match(
    registry,
    /GCF_GLOBAL_CASH_FLOW:\s*\{[^}]*fact_key:\s*["']GCF_GLOBAL_CASH_FLOW["']/,
    "registry must define GCF_GLOBAL_CASH_FLOW with matching fact_key",
  );
});
