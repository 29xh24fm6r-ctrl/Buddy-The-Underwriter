#!/usr/bin/env node
/**
 * SPEC-BUDDY-HARD-STOP-AUDIT-AND-RECOVERY-1 #4:
 * Scan every `fetch("/api/...")` (static + template) in client/server code
 * and assert the targeted route exists under src/app/api/. Exits non-zero
 * when a fetch points at a deleted route — the failure mode that caused
 * /api/aegis/health, /api/auth/role, and /api/deals/<id>/uploads/status
 * to silently 404 after route-cap cleanup.
 *
 * Matching:
 *   - Dynamic segments on the route side ([param], [...path], [[...slug]])
 *     match concrete segments.
 *   - Template-literal `${...}` segments on the fetch side are treated as
 *     wildcards matching exactly one path segment.
 *   - Query strings are stripped before matching.
 *
 * Run: `npm run check:api-fetches`
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
// SPEC-PORTAL-1 §5: SRC/API dirs are overridable so the guard can run against a
// fixture tree in tests (defaults are the real repo paths).
const SRC = process.env.FETCH_GUARD_SRC_DIR
  ? resolve(process.env.FETCH_GUARD_SRC_DIR)
  : join(ROOT, "src");
const API_DIR = process.env.FETCH_GUARD_API_DIR
  ? resolve(process.env.FETCH_GUARD_API_DIR)
  : join(SRC, "app", "api");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

// src/app/api/deals/[dealId]/loan-requests/route.ts → /api/deals/[dealId]/loan-requests
function routeFileToUrl(file) {
  const rel = file.slice(SRC.length + "/app".length).replace(/\\/g, "/");
  return rel.replace(/\/route\.(ts|tsx|js|mjs)$/, "");
}

const SEG_PARAM = Symbol("param"); // [param]
const SEG_CATCH = Symbol("catch"); // [...catchall]
const SEG_OPT = Symbol("opt");     // [[...optional]]
const SEG_DYN = Symbol("dyn");     // ${...} (fetch side)

function routeSegments(url) {
  return url.split("/").filter(Boolean).map((seg) => {
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) return SEG_OPT;
    if (/^\[\.\.\..+\]$/.test(seg)) return SEG_CATCH;
    if (/^\[.+\]$/.test(seg)) return SEG_PARAM;
    return seg;
  });
}

function fetchSegments(url) {
  // Strip query string + hash.
  const cleaned = url.split(/[?#]/)[0];
  return cleaned.split("/").filter(Boolean).map((seg) => {
    // If the segment is exactly or contains `${...}`, treat the whole
    // segment as a single-segment wildcard. Mixed cases like
    // `auto-seed-lite/${params}` happen only on the LAST segment in this
    // codebase; in those cases the literal prefix usually matches a
    // route segment alone, but we conservatively wildcard the whole
    // segment so we don't false-positive.
    if (/\$\{[^}]+\}/.test(seg)) return SEG_DYN;
    return seg;
  });
}

// Match a fetched URL segment list against a single route's segment list.
function matchSegments(routeSegs, fetchSegs) {
  // Try with greedy handling of catch-all.
  let ri = 0;
  let fi = 0;
  while (ri < routeSegs.length && fi < fetchSegs.length) {
    const r = routeSegs[ri];
    const f = fetchSegs[fi];
    if (r === SEG_CATCH) {
      // Catch-all eats the rest of the fetched segments.
      return true;
    }
    if (r === SEG_OPT) {
      // Optional catch-all eats remaining or nothing.
      return true;
    }
    if (r === SEG_PARAM || f === SEG_DYN) {
      ri++; fi++;
      continue;
    }
    if (r === f) {
      ri++; fi++;
      continue;
    }
    return false;
  }
  // After loop, consume optional catch-all in route if any.
  while (ri < routeSegs.length && routeSegs[ri] === SEG_OPT) ri++;
  return ri === routeSegs.length && fi === fetchSegs.length;
}

const ROUTE_FILES = walk(API_DIR).filter((f) =>
  /\/route\.(ts|tsx|js|mjs)$/.test(f),
);
const ROUTES = ROUTE_FILES.map(routeFileToUrl).map((u) => ({
  url: u,
  segs: routeSegments(u),
}));

// External / intentional fetches that look like internal /api routes
// but are NOT served by src/app/api. Anything here exits 0 silently.
const ALLOWLIST = new Set([
  "/api/aegis/health", // Deliberately removed; one consumer comments it out.
]);

// Stale fetches inherited from earlier route-cap cleanups that have not
// yet been remediated. Tracked individually here so this guard surfaces
// the ongoing list without breaking CI for unrelated work. Each entry
// must include a one-line reason; when the underlying client is fixed,
// remove the entry. NEW stale fetches will still fail the guard.
const KNOWN_STALE_PENDING_FIX = new Map([
  [
    "/api/deals/${props.dealId}/status",
    "DealStageEtaControls expects a generic per-deal /status that no longer exists (TODO: route to /pricing/status or /intake/status)",
  ],
  [
    "/api/deals/${dealId}/messages/${messageId}",
    "ConditionMessagingCard DELETE/PATCH against a removed per-message route (TODO)",
  ],
  [
    "/api/deals/${dealId}/messages/${messageId}/approve",
    "DraftMessagesCard expects an approve route that was removed (TODO: replace with /drafts/[draftId]/approve)",
  ],
  [
    "/api/deals/${dealId}/missing-docs/send",
    "MissingDocsCard posts to a /send sub-path that does not exist (TODO: replace with /outbound/missing-docs/send)",
  ],
  [
    "/api/tenant/current-bank",
    "UploadBox reads a removed tenant endpoint (TODO: replace with /api/banks/current or remove)",
  ],
  [
    "/api/deals/${encodeURIComponent(props.dealId)}/credit-memo/geometry?fileId=${encodeURIComponent(fileId!)}",
    "DealEvidenceDeepLinkHandler missing memoId segment vs surviving /credit-memo/[memoId]/geometry (TODO)",
  ],
  [
    "/api/deals/${dealId}/underwriting/refresh",
    "AnalystWorkbench expects a /refresh sub-path that was removed (TODO)",
  ],
  [
    // SPEC-PORTAL-1 §4c: surfaced once the wrapper-aware needle began scanning
    // useSWR()/j() calls. Pre-existing dead deals route, out of scope for the
    // borrower portal fix (TODO: restore /uploads/status or repoint UploadStatusCard).
    "/api/deals/${dealId}/uploads/status",
    "UploadStatusCard polls a removed per-deal uploads/status route (TODO)",
  ],
]);

// Files / directories to skip entirely. Stitch activation modules build
// URLs by concatenation and produce trailing-slash prefixes the static
// scanner can't resolve. They are routed at runtime by other systems.
const SKIP_FILE_PATTERNS = [
  /\/src\/lib\/stitch\/activations\//,
];

const matches = [];
const knownStaleHits = [];

// SPEC-PORTAL-1 §4c: also scan common URL-first wrappers whose first argument is
// an /api literal — the borrower upload client hid its dead-route calls inside a
// `j()` JSON wrapper, which the fetch/axios-only needle missed. `\bj(?:<...>)?`
// matches `j(` and `j<Generic>(` without matching identifiers like `obj(`/`json(`.
const NEEDLE = /(?:fetch|axios\.(?:get|post|put|patch|delete)|\bj(?:<[^>]*>)?|\buseSWR)\s*\(\s*([`"'])(\/api\/[^`"']+)\1/g;

const FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
for (const file of FILES) {
  if (SKIP_FILE_PATTERNS.some((re) => re.test(file))) continue;
  if (/\/app\/api\//.test(file) && /\/route\.(ts|tsx)$/.test(file)) continue;
  const src = readFileSync(file, "utf8");
  let m;
  NEEDLE.lastIndex = 0;
  while ((m = NEEDLE.exec(src)) !== null) {
    const raw = m[2];
    if (ALLOWLIST.has(raw.split(/[?#]/)[0])) continue;
    const fSegs = fetchSegments(raw);
    let resolves = false;
    for (const r of ROUTES) {
      if (matchSegments(r.segs, fSegs)) {
        resolves = true;
        break;
      }
    }
    if (resolves) continue;
    const lineNum = src.slice(0, m.index).split("\n").length;
    const entry = {
      file: file.slice(ROOT.length + 1),
      line: lineNum,
      url: raw,
    };
    if (KNOWN_STALE_PENDING_FIX.has(raw)) {
      knownStaleHits.push({
        ...entry,
        reason: KNOWN_STALE_PENDING_FIX.get(raw),
      });
    } else {
      matches.push(entry);
    }
  }
}

if (knownStaleHits.length > 0) {
  console.warn(
    `\ncheck:api-fetches — ${knownStaleHits.length} known stale fetch(es) still pending fix:`,
  );
  for (const h of knownStaleHits) {
    console.warn(`  ${h.file}:${h.line}  →  ${h.url}`);
    console.warn(`    reason: ${h.reason}`);
  }
}

if (matches.length > 0) {
  console.error(
    `\ncheck:api-fetches — NEW deleted-route fetch(es) detected (${matches.length}). These point at routes that no longer exist under src/app/api/ and will 404 in production:`,
  );
  for (const m of matches) {
    console.error(`  ${m.file}:${m.line}  →  ${m.url}`);
  }
  console.error(
    `\nFix: either restore the route, replace with a surviving equivalent, or remove the fetch. If the URL is intentionally external, add it to ALLOWLIST. If it is a pre-existing stale fetch that you cannot fix in this PR, add it to KNOWN_STALE_PENDING_FIX with a TODO reason in scripts/check-client-api-fetches.mjs.\n`,
  );
  process.exit(1);
}

console.log(
  `check:api-fetches — OK. ${ROUTES.length} routes defined; ${knownStaleHits.length} known stale fetch(es) tracked.`,
);
