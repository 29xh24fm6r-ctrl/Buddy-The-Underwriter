#!/usr/bin/env node
/**
 * CI guard — every server-side reference to the brokerage-critical
 * tables must use the admin client (`supabaseAdmin()`), not a
 * publishable / anon client.
 *
 * Once RLS is enabled (SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.4 + §3.5),
 * an accidental non-admin client touching these tables will silently
 * return zero rows. This guard surfaces such a regression at PR time.
 *
 * Failure rules:
 *   - File mentions one of the protected tables AND
 *   - File does not import `supabaseAdmin` (or one of the documented
 *     allowlist of admin-wrapper modules)
 *   - → fail with the offending file + table.
 *
 * Allowlist: files that legitimately reference the table inside a
 * string but never query it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const ROOTS = ["src", "scripts", "supabase/migrations", "specs"];
const PROTECTED = ["borrower_session_tokens", "rate_limit_counters"];

const ALLOWED_FILES = new Set([
  // Migrations create / alter the tables — no client involved.
  "supabase/migrations/20260425_brokerage_tenant_model.sql",
  "supabase/migrations/20260425_rate_limit_counters.sql",
  "supabase/migrations/20260621000003_brokerage_rls_stage_a.sql",
  "supabase/rollback/20260621000003_brokerage_rls_stage_a_inverse.sql",
  // Specs / docs reference the tables in prose.
  "specs/brokerage/SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1.md",
  "specs/brokerage/SPEC-BROKERAGE-PRODUCTIONIZATION-V1.md",
  "specs/security/SPEC-BROKERAGE-RLS-HARDENING.md",
  // This guard itself.
  "scripts/guards/guard-brokerage-rls-tables.mjs",
  // Migration shape test reads SQL files; never queries the tables.
  "src/lib/brokerage/__tests__/launchBlockerMigrationsShape.test.ts",
  // Dependency-injection helpers — reviewed safe. These construct NO Supabase
  // client of their own; they receive `sb` as a parameter and query the table
  // through it. The admin client is supplied by every caller (verified: the
  // brokerage scripts build it with SUPABASE_SERVICE_ROLE_KEY; in-app callers
  // pass supabaseAdmin()). The import-based check cannot see the injected
  // client, so these are allowlisted rather than forced to import supabaseAdmin.
  "src/lib/brokerage/conversionFunnel.ts",
  "src/lib/brokerage/liveFunnelCheck.ts",
  "src/lib/brokerage/businessReadinessGate.ts",
  // Their unit tests reference the table name only inside in-memory fake stores
  // (no real client of any kind).
  "src/lib/brokerage/__tests__/conversionFunnel.test.ts",
  "src/lib/brokerage/__tests__/liveFunnelCheck.test.ts",
]);

const PUBLISHABLE_CLIENT_HINTS = [
  "createClient(", // raw @supabase/supabase-js
  "supabaseBrowser(",
  "publishable",
  "anon_key",
  "anonKey",
];

const ADMIN_CLIENT_HINT = "supabaseAdmin";

const violations = [];

function collectFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      out.push(...collectFiles(full));
    } else if (/\.(ts|tsx|mjs|js|sql|md)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

for (const root of ROOTS) {
  const dir = join(REPO_ROOT, root);
  const files = collectFiles(dir);
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    if (ALLOWED_FILES.has(rel)) continue;
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const table of PROTECTED) {
      if (!content.includes(table)) continue;
      const usesAdmin = content.includes(ADMIN_CLIENT_HINT);
      const usesPublishable = PUBLISHABLE_CLIENT_HINTS.some((h) =>
        content.includes(h),
      );
      if (!usesAdmin && usesPublishable) {
        violations.push({ file: rel, table, reason: "publishable_without_admin" });
        continue;
      }
      // SQL / MD references without a client are fine if explicitly allowed
      // (allowlist above) or if it's a migration with neither client hint.
      if (!usesAdmin && !file.endsWith(".sql") && !file.endsWith(".md")) {
        // TS/TSX file references the protected table without importing
        // the admin client. Could be a documentation comment — flag for review.
        violations.push({ file: rel, table, reason: "ts_reference_without_admin_import" });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("\n[guard-brokerage-rls-tables] FAIL — non-admin references found:");
  for (const v of violations) {
    console.error(`  - ${v.file} → ${v.table}  (${v.reason})`);
  }
  console.error(
    "\nFix: every server-side caller of the brokerage-critical tables must",
  );
  console.error("import { supabaseAdmin } from '@/lib/supabase/admin'.");
  console.error(
    "If this file is intentionally documentation, add it to ALLOWED_FILES.",
  );
  process.exit(1);
}

console.log(
  `[guard-brokerage-rls-tables] OK — ${PROTECTED.length} tables, all references admin-scoped`,
);
