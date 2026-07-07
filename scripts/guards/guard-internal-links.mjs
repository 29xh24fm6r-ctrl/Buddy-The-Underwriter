// scripts/guards/guard-internal-links.mjs
// SPEC-PORTAL-1 §4b — internal link guard.
//
// Every static internal navigation target — `<Link href="/…">`, `href={"/…"}`,
// `router.push("/…")`, `router.replace("/…")` — must resolve to a real page route
// under src/app/**/page.tsx. Prevents shipping NEW dead links (the audit found a
// pile of them: /capture/*, /tenant/create, /borrower/portal/demo, /privacy, …).
//
// Only STRICT string literals are checked. Template literals with `${…}`,
// external URLs (http…), anchors (#…), and mailto: are skipped (R5).
// next.config.mjs rewrites are honored if present (currently none).
//
// Existing dead links are parked in a remove-only allowlist tagged for
// SPEC-DEADLINK-CLEANUP-1; the guard's job here is to stop NEW ones (Principle #13).
//
// Env overrides (fixture tests): LINK_GUARD_APP_DIR, LINK_GUARD_SRC_DIR,
// LINK_GUARD_ALLOWLIST.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_DIR = process.env.LINK_GUARD_APP_DIR || path.join(ROOT, "src/app");
const SRC_DIR = process.env.LINK_GUARD_SRC_DIR || path.join(ROOT, "src");
const ALLOWLIST_PATH = process.env.LINK_GUARD_ALLOWLIST || path.join(ROOT, "scripts/guards/internal-links-allowlist.txt");

function walk(dir, test, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, test, out);
    else if (entry.isFile() && test(entry.name)) out.push(full);
  }
  return out;
}

const SEG_PARAM = Symbol("param");
const SEG_CATCH = Symbol("catch");
const SEG_OPT = Symbol("opt");

// src/app/(app)/deals/[dealId]/page.tsx → segments for /deals/[dealId]
// Route groups (…) are dropped; params become wildcards.
function pageFileToSegments(file) {
  const rel = file.slice(APP_DIR.length).replace(/\\/g, "/").replace(/\/page\.(tsx|ts|jsx|js)$/, "");
  return rel.split("/").filter(Boolean)
    .filter((seg) => !/^\(.+\)$/.test(seg)) // drop route groups
    .map((seg) => {
      if (/^\[\[\.\.\..+\]\]$/.test(seg)) return SEG_OPT;
      if (/^\[\.\.\..+\]$/.test(seg)) return SEG_CATCH;
      if (/^\[.+\]$/.test(seg)) return SEG_PARAM;
      return seg;
    });
}

function linkToSegments(url) {
  const cleaned = url.split(/[?#]/)[0];
  return cleaned.split("/").filter(Boolean);
}

function matchSegments(routeSegs, linkSegs) {
  let ri = 0;
  let li = 0;
  while (ri < routeSegs.length && li < linkSegs.length) {
    const r = routeSegs[ri];
    if (r === SEG_CATCH || r === SEG_OPT) return true; // eats the rest
    if (r === SEG_PARAM) { ri++; li++; continue; }
    if (r === linkSegs[li]) { ri++; li++; continue; }
    return false;
  }
  while (ri < routeSegs.length && routeSegs[ri] === SEG_OPT) ri++;
  return ri === routeSegs.length && li === linkSegs.length;
}

function collectRoutes() {
  return walk(APP_DIR, (n) => /^page\.(tsx|ts|jsx|js)$/.test(n)).map(pageFileToSegments);
}

// Static internal links: href="/…", href={"/…"}, router.push/replace("/…").
// The `[^"'`$]` class stops at `$`, so any `${…}` template link is skipped whole.
const LINK_RE = /(?:href\s*=\s*\{?\s*|router\.(?:push|replace)\(\s*)(["'])(\/[^"'`$]*)\1/g;

function collectLinks() {
  const links = [];
  for (const file of walk(SRC_DIR, (n) => /\.(tsx|ts)$/.test(n))) {
    if (/\/scripts\//.test(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(src)) !== null) {
      const url = m[2];
      if (url.startsWith("/api/")) continue; // API links covered by check:api-fetches
      const line = src.slice(0, m.index).split("\n").length;
      links.push({ file: path.relative(ROOT, file), line, url });
    }
  }
  return links;
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return new Set();
  return new Set(
    fs.readFileSync(ALLOWLIST_PATH, "utf8")
      .split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

function main() {
  const routes = collectRoutes();
  const allow = readAllowlist();
  const links = collectLinks();

  const offenders = [];
  for (const link of links) {
    const clean = link.url.split(/[?#]/)[0];
    if (allow.has(clean)) continue;
    const segs = linkToSegments(link.url);
    if (routes.some((r) => matchSegments(r, segs))) continue;
    offenders.push(link);
  }

  if (offenders.length === 0) {
    console.log(
      `✅ internal-links guard passed (${links.length} static internal link(s); ` +
        `${routes.length} page routes, ${allow.size} allowlisted).`,
    );
    return;
  }

  console.error(
    "\n❌ static internal link(s) resolve to no page route under src/app (SPEC-PORTAL-1 §4b):\n",
  );
  for (const o of offenders) console.error(` - ${o.file}:${o.line}  →  ${o.url}`);
  console.error(
    "\nFix: point the link at a real route, or — for an intentional stub/deferred " +
      "page — add the path to scripts/guards/internal-links-allowlist.txt.\n",
  );
  process.exit(1);
}

main();
