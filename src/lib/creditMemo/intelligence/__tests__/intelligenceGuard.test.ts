/**
 * Intelligence Layer Ownership Guards
 *
 * Invariants enforced:
 *   1. Intelligence engines never import buildCanonicalCreditMemo
 *      (must read only from credit_memo_snapshots.memo_output_json)
 *   2. Intelligence files never call .insert() / .update() / .delete()
 *      on credit_memo_snapshots — strictly read-only
 *   3. Intelligence route only reads (no mutating Supabase calls in the
 *      intelligence module's directory)
 *   4. Intelligence module does not read live deal_financial_facts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const INTELLIGENCE_DIR = join(REPO_ROOT, "src", "lib", "creditMemo", "intelligence");
const INTELLIGENCE_ROUTE_DIR = join(
  REPO_ROOT,
  "src",
  "app",
  "api",
  "deals",
  "[dealId]",
  "credit-memo",
  "intelligence",
);

function* walkTs(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next") continue;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walkTs(full);
    else if (st.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx"))) yield full;
  }
}

function readBody(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function intelligenceFiles(): string[] {
  const out: string[] = [];
  for (const p of walkTs(INTELLIGENCE_DIR)) {
    if (p.includes("/__tests__/")) continue;
    out.push(p);
  }
  for (const p of walkTs(INTELLIGENCE_ROUTE_DIR)) {
    out.push(p);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Guard 1: No buildCanonicalCreditMemo import anywhere in intelligence
// ═══════════════════════════════════════════════════════════════════════════

test("[intel-1] intelligence files must not import buildCanonicalCreditMemo", () => {
  const offenders: string[] = [];
  for (const path of intelligenceFiles()) {
    const body = readBody(path);
    if (/from\s+["']@\/lib\/creditMemo\/canonical\/buildCanonicalCreditMemo["']/.test(body) ||
        /import.*buildCanonicalCreditMemo/.test(body)) {
      offenders.push(relative(REPO_ROOT, path));
    }
  }
  if (offenders.length > 0) {
    assert.fail(
      `Intelligence layer must read from frozen snapshots only.\n` +
        `Offenders importing buildCanonicalCreditMemo:\n${offenders.map((p) => `  ${p}`).join("\n")}`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 2: Intelligence files must not write credit_memo_snapshots
// ═══════════════════════════════════════════════════════════════════════════

test("[intel-2] intelligence files must not insert/update/delete credit_memo_snapshots", () => {
  const offenders: Array<{ path: string; line: number; preview: string }> = [];
  for (const path of intelligenceFiles()) {
    const body = readBody(path);
    const lines = body.split(/\r?\n/);
    lines.forEach((ln, i) => {
      // Match Supabase mutation patterns on credit_memo_snapshots:
      //   .from("credit_memo_snapshots").insert(...)
      //   .from("credit_memo_snapshots").update(...)
      //   .from("credit_memo_snapshots").delete(...)
      // Allow these patterns to appear separately from .from() — we check
      // the same file has both .from("credit_memo_snapshots") and a
      // mutation method.
      if (/\.(insert|update|delete|upsert)\s*\(/.test(ln)) {
        // Only flag if this file also references credit_memo_snapshots.
        if (body.includes('"credit_memo_snapshots"') || body.includes("'credit_memo_snapshots'")) {
          offenders.push({
            path: relative(REPO_ROOT, path),
            line: i + 1,
            preview: ln.trim().slice(0, 200),
          });
        }
      }
    });
  }
  if (offenders.length > 0) {
    const detail = offenders
      .map((o) => `  ${o.path}:${o.line}  ${o.preview}`)
      .join("\n");
    assert.fail(
      `Intelligence layer must be read-only on credit_memo_snapshots.\n${detail}`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 3: Intelligence route uses only .select() on Supabase
// ═══════════════════════════════════════════════════════════════════════════

test("[intel-3] intelligence route only uses .select() on credit_memo_snapshots", () => {
  const routePath = join(INTELLIGENCE_ROUTE_DIR, "route.ts");
  const body = readBody(routePath);
  assert.ok(body.length > 0, "intelligence route must exist");
  // Must reference credit_memo_snapshots and .select(); must NOT contain
  // mutation verbs.
  assert.ok(body.includes('"credit_memo_snapshots"'), "must read from credit_memo_snapshots");
  assert.ok(/\.select\(/.test(body), "must use .select()");
  assert.equal(/\.(insert|update|delete|upsert)\s*\(/.test(body), false,
    "must not call insert/update/delete/upsert");
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 4: No live deal_financial_facts reads from intelligence layer
// ═══════════════════════════════════════════════════════════════════════════

test("[intel-4] intelligence layer does not query deal_financial_facts directly", () => {
  const offenders: string[] = [];
  for (const path of intelligenceFiles()) {
    const body = readBody(path);
    if (body.includes('"deal_financial_facts"') || body.includes("'deal_financial_facts'")) {
      offenders.push(relative(REPO_ROOT, path));
    }
  }
  if (offenders.length > 0) {
    assert.fail(
      `Intelligence must read from frozen snapshots only — NOT live deal_financial_facts.\n` +
        offenders.map((p) => `  ${p}`).join("\n"),
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 5: Intelligence engines are pure — no server-only or DB imports
// ═══════════════════════════════════════════════════════════════════════════

test("[intel-5] pure engines (diff/risk/decisions) do not import server-only modules", () => {
  const PURE_FILES = [
    "diffSnapshots.ts",
    "computeRiskDelta.ts",
    "analyzeUnderwriterDecisions.ts",
    "types.ts",
  ];
  const offenders: Array<{ path: string; offender: string }> = [];
  for (const filename of PURE_FILES) {
    const path = join(INTELLIGENCE_DIR, filename);
    const body = readBody(path);
    if (!body) continue;
    // Banned imports — these would couple pure engines to server runtime.
    const bannedImports = [
      "@/lib/supabase/admin",
      "@/lib/supabase/server",
      "server-only",
      "@/lib/auth/",
    ];
    for (const banned of bannedImports) {
      const re = new RegExp(`from\\s+["']${banned.replace(/[.*+?^${}()|[\\\]\\\\]/g, "\\\\$&")}`);
      if (re.test(body)) {
        offenders.push({ path: filename, offender: banned });
      }
    }
  }
  if (offenders.length > 0) {
    assert.fail(
      `Pure intelligence engines must not import server-only modules.\n` +
        offenders.map((o) => `  ${o.path} imports ${o.offender}`).join("\n"),
    );
  }
});
