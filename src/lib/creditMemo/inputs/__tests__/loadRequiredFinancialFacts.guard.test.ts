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

  // Must use CANONICAL_FACTS.DSCR.fact_key (and the other three) somewhere in
  // the file. Each of these substrings is sufficient evidence that the reader
  // is parameterised by the registry rather than a hardcoded string literal.
  for (const ref of [
    "CANONICAL_FACTS.DSCR.fact_key",
    "CANONICAL_FACTS.ANNUAL_DEBT_SERVICE.fact_key",
    "CANONICAL_FACTS.GLOBAL_CASH_FLOW.fact_key",
    "CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_key",
  ]) {
    assert.ok(
      src.includes(ref),
      `buildMemoInputPackage.ts must reference ${ref}`,
    );
  }

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
