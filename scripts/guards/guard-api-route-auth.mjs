// scripts/guards/guard-api-route-auth.mjs
//
// SPEC-SEC-API-AUTH-1 — API authorization coverage, whole tree.
//
// Clerk middleware (src/proxy.ts) deliberately does NOT gate /api/**:
//
//     HARD RULE:
//     - Never protect /api/** in middleware.
//       API routes must return JSON 401/403 and must be curl/automation-friendly.
//
// That is a reasonable choice, but it makes every one of the ~810 route
// handlers individually responsible for its own authorization. There was a
// guard for exactly this (guard-deal-route-access.mjs) but its scan root is
// src/app/api/deals/[dealId], so it never looked at /api/portal, /api/brokerage,
// /api/borrower, /api/banks or /api/storage — which is where the borrower-facing
// buddysba.com surface lives.
//
// The 2026-08-26 audit found the consequence: POST /api/portal/create-link and
// POST /api/portal/send-link had no authentication at all. send-link minted a
// portal token for any deal_id AND relayed caller-supplied text to a
// caller-supplied phone number through the platform's Twilio account.
//
// CONTRACT (deliberately weaker than the deal-route guard's):
//   A route that calls supabaseAdmin() — the service-role client, which
//   bypasses RLS entirely — must reference at least one recognised
//   authorization mechanism. This guard does NOT verify that the mechanism is
//   correctly bound to the resource being addressed; guard-deal-route-access
//   does that for the deal subtree, and requireInviteForDeal covers the portal
//   invite routes. This guard answers only "is there a lock on the door".
//
// Routes under src/app/api/deals/[dealId] are skipped — guard-deal-route-access
// owns those with a stricter contract, and double-reporting helps nobody.
//
// The allowlist is REMOVE-ONLY. A stale entry (a path that no longer fails)
// also fails the guard, so the list can only shrink.
//
// Env overrides (used by the guard's own fixture tests):
//   API_AUTH_GUARD_BASE       repo root for relative-path identity (cwd)
//   API_AUTH_GUARD_ROOT       route tree to scan
//   API_AUTH_GUARD_ALLOWLIST  allowlist file path
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.API_AUTH_GUARD_BASE || process.cwd();
const ROUTES_ROOT = process.env.API_AUTH_GUARD_ROOT || path.join(BASE, "src/app/api");
const ALLOWLIST_PATH =
  process.env.API_AUTH_GUARD_ALLOWLIST ||
  path.join(BASE, "scripts/guards/api-route-auth-allowlist.txt");

// Owned by guard-deal-route-access.mjs (stricter contract). Relative to BASE.
const SKIP_PREFIXES = ["src/app/api/deals/[dealId]/"];

// Any one of these is accepted as "this route authorizes itself". Each either
// resolves a signed-in principal, validates a bearer/portal/share token, or
// checks a shared worker secret.
const AUTH_MECHANISMS = [
  // Clerk / tenant
  "clerkAuth(",
  "clerkCurrentUser(",
  "auth(",
  "currentUser(",
  "getCurrentBankId(",
  "getBrokerageBankId(",
  "ensureDealBankAccess(",
  "ensureDealBankAccessAllowingBrokerageStaff(",
  "requireDealAccess(",
  "requireDealCockpitAccess(",
  "requireUnderwriterOnDeal(",
  "requireAnyParticipant(",
  "requireBrokerageStaff(",
  "requireBankAdmin(",
  "requireAdmin(",
  "requireSuperAdmin(",
  "requireSignedIn(",
  "requireRole(",
  "requireUser(",
  "requireUserId(",
  "verifyCronSecret(",
  // Borrower / portal / owner / share tokens
  "requireValidInvite(",
  "requireInviteForDeal(",
  "requireValidShareToken(",
  "requireValidOwnerPortal(",
  "resolvePortalContext(",
  "resolvePortalToken(",
  "resolvePortalContextFromToken(",
  "resolveBorrowerToken(",
  "getBorrowerSession(",
  "getOrCreateBorrowerSession(",
  "getBorrowerSessionFromRequest(",
  "createBorrowerSession(",
  "requireQaBorrowerContext(",
  "requireBorrowerToken(",
  "resolveDealFromToken(",
  "validateUploadSession(",
  "requireUserId(",
  "safeClerkAuth(",
  "tryGetCurrentBankId(",
  "resolveLenderIdentity(",
  "getActiveGrant(",
  "auth.getUser(",
  "requireBrokerageCommsAdmin(",
  // Worker / cron / vendor webhooks
  "hasValidWorkerSecret(",
  "getWorkerAuthMatch(",
  "secretEquals(",
  "WORKER_SECRET",
  "CRON_SECRET",
  "BUDDY_GATEWAY_SECRET",
  "verifyWebhookSignature(",
  "verifyTwilioSignature(",
  "verifyPlaidWebhook(",
  "constructWebhookEvent(",
];

// Several older borrower routes validate their token inline rather than via a
// helper — they look the caller up by the opaque token itself. That is real
// token authentication, so recognise the idiom. Narrow on purpose: the token
// must be used as a lookup key, not merely mentioned.
const INLINE_TOKEN_LOOKUPS = [
  '.eq("access_token"',
  ".eq('access_token'",
  '.eq("token_hash"',
  ".eq('token_hash'",
  '.eq("token"',
  ".eq('token'",
];

// A route may declare itself deliberately public. The marker must carry a
// reason so the choice is reviewable in the diff.
const PUBLIC_MARKER = /\/\/\s*route-class:\s*PUBLIC\s*—\s*\S+/;

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

function isProtected(content) {
  if (PUBLIC_MARKER.test(content)) return true;
  if (AUTH_MECHANISMS.some((fn) => content.includes(fn))) return true;
  return INLINE_TOKEN_LOOKUPS.some((idiom) => content.includes(idiom));
}

// Only routes that reach the service-role client are in scope. A route that
// only uses the RLS-scoped client is already constrained by the database.
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
  const files = walkRouteFiles(ROUTES_ROOT).filter((abs) => {
    const id = relId(abs);
    return !SKIP_PREFIXES.some((p) => id.startsWith(p));
  });

  const failing = new Set();
  for (const abs of files) {
    if (failsBaseCheck(fs.readFileSync(abs, "utf8"))) failing.add(relId(abs));
  }

  const allowlist = readAllowlist();
  const allowSet = new Set(allowlist);

  const unpatched = [...failing].filter((f) => !allowSet.has(f)).sort();
  const stale = allowlist.filter((f) => !failing.has(f)).sort();

  if (unpatched.length === 0 && stale.length === 0) {
    console.log(
      `✅ api-route-auth guard passed (${files.length} routes scanned; ` +
        `${failing.size} on the SPEC-SEC-API-AUTH-1 allowlist).`,
    );
    return;
  }

  if (unpatched.length) {
    console.error(
      "\n❌ route(s) call supabaseAdmin() (service role — RLS does not apply) " +
        "without any recognised authorization, and are not on the allowlist:\n",
    );
    for (const f of unpatched) console.error(` - ${f}`);
    console.error(
      "\nFix: authorize the route (ensureDealBankAccess / requireBrokerageStaff /\n" +
        "requireInviteForDeal / hasValidWorkerSecret / …), or — if it is genuinely\n" +
        "public — add a marker stating why:\n" +
        "  // route-class: PUBLIC — <reason this needs no caller identity>\n" +
        "Do NOT add new entries to the allowlist; it is remove-only.\n",
    );
  }

  if (stale.length) {
    console.error(
      "\n❌ stale allowlist entries (these routes now pass, or no longer exist). " +
        "Remove them — the allowlist may only shrink:\n",
    );
    for (const f of stale) console.error(` - ${f}`);
    console.error("");
  }

  process.exit(1);
}

main();
