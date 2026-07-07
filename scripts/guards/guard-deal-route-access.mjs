// scripts/guards/guard-deal-route-access.mjs
// SPEC-SEC-1 — Deal Route Tenant Isolation
//
// Clerk middleware (src/proxy.ts) deliberately does NOT gate /api/**, so every
// route under src/app/api/deals/[dealId]/** that uses supabaseAdmin() (service
// role, bypasses RLS) keyed by the URL dealId must enforce access itself.
//
// For each route.ts under the deal-route tree that calls `supabaseAdmin(`:
//   PASS if it calls assertDealAccess( or withDealAccess(            (CLERK)
//   PASS if it has `// route-class: BORROWER_TOKEN` AND a token-validation call
//   PASS if it has `// route-class: WORKER` AND a worker-secret check
//   Otherwise FAIL — unless the file is on the temporary allowlist
//   (SPEC-SEC-2 worklist). The allowlist is remove-only; a stale entry (a path
//   that no longer fails the base check) also FAILS, so it can only shrink.
//
// Env overrides (used by the guard's own fixture tests):
//   DEAL_ROUTE_GUARD_BASE       repo root for relative-path identity (cwd)
//   DEAL_ROUTE_GUARD_ROOT       route tree to scan
//   DEAL_ROUTE_GUARD_ALLOWLIST  allowlist file path
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.DEAL_ROUTE_GUARD_BASE || process.cwd();
const ROUTES_ROOT =
  process.env.DEAL_ROUTE_GUARD_ROOT ||
  path.join(BASE, "src/app/api/deals/[dealId]");
const ALLOWLIST_PATH =
  process.env.DEAL_ROUTE_GUARD_ALLOWLIST ||
  path.join(BASE, "scripts/guards/deal-route-access-allowlist.txt");

// Portal-token validation functions (BORROWER_TOKEN routes must call one).
const TOKEN_VALIDATORS = [
  "resolvePortalToken",
  "resolvePortalContextFromToken",
  "resolvePortalContext",
];
// Worker-secret env names (WORKER routes must reference one).
const WORKER_SECRETS = ["WORKER_SECRET", "CRON_SECRET"];

function walkRouteFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkRouteFiles(full));
    else if (entry.isFile() && entry.name === "route.ts") out.push(full);
  }
  return out;
}

function relId(absFile) {
  return path.relative(BASE, absFile).split(path.sep).join("/");
}

// Does this route file satisfy the access contract on its own merits?
function isProtected(content) {
  if (content.includes("assertDealAccess(") || content.includes("withDealAccess(")) {
    return true;
  }
  if (content.includes("// route-class: BORROWER_TOKEN")) {
    return TOKEN_VALIDATORS.some((fn) => content.includes(`${fn}(`));
  }
  if (content.includes("// route-class: WORKER")) {
    return WORKER_SECRETS.some((s) => content.includes(s));
  }
  return false;
}

// A route "fails the base check" if it uses supabaseAdmin and is not protected.
function failsBaseCheck(content) {
  if (!content.includes("supabaseAdmin(")) return false;
  return !isProtected(content);
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return [];
  return fs
    .readFileSync(ALLOWLIST_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function main() {
  const files = walkRouteFiles(ROUTES_ROOT);
  const failing = new Set();

  for (const abs of files) {
    const content = fs.readFileSync(abs, "utf8");
    if (failsBaseCheck(content)) failing.add(relId(abs));
  }

  const allowlist = readAllowlist();
  const allowSet = new Set(allowlist);

  // Unpatched: fails the base check AND not allowlisted.
  const unpatched = [...failing].filter((f) => !allowSet.has(f)).sort();

  // Stale: on the allowlist but no longer failing (patched or removed) — the
  // allowlist may only shrink, so these must be removed.
  const stale = allowlist.filter((f) => !failing.has(f)).sort();

  if (unpatched.length === 0 && stale.length === 0) {
    console.log(
      `✅ deal-route-access guard passed (${files.length} deal routes scanned; ` +
        `${failing.size} on SPEC-SEC-2 allowlist).`,
    );
    return;
  }

  if (unpatched.length) {
    console.error(
      "\n❌ deal route(s) use supabaseAdmin() without assertDealAccess/withDealAccess " +
        "or a valid route-class marker, and are not on the SPEC-SEC-2 allowlist:\n",
    );
    for (const f of unpatched) console.error(` - ${f}`);
    console.error(
      "\nFix: add `await assertDealAccess(dealId)` (or wrap with withDealAccess), " +
        "or mark the route `// route-class: BORROWER_TOKEN` / `// route-class: WORKER` " +
        "with the matching validation.\n",
    );
  }

  if (stale.length) {
    console.error(
      "\n❌ stale allowlist entries (no longer fail the check — remove them, " +
        "the allowlist is remove-only):\n",
    );
    for (const f of stale) console.error(` - ${f}`);
    console.error("");
  }

  process.exit(1);
}

main();
