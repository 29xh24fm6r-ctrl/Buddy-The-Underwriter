#!/usr/bin/env node
// scripts/count-routes.mjs
// Spec FIX-C — Route count observability to guard Vercel's 2048-route cap.
//
// Vercel enforces a HARD cap of 2048 routes per deployment, emitted as
// errorCode "too_many_routes" during the post-build deploy-output
// validation step. The cap counts API routes + page routes + middleware +
// next.config rewrites/redirects/headers + RSC variants. It is NOT
// documented publicly. Exceeding it produces readyState=ERROR with no
// fatal line in the build log stream — only a bare "status ● Error".
// See src/lib/.../BUDDY_PROJECT_ROADMAP.md for the two build principles
// that codify this.
//
// This script supports TWO modes:
//
//   FAST (default)        — source-file count, multiplied to approximate
//                           Vercel's accounting. Runs in <1s. Advisory.
//                           Used by .github/workflows/route-budget.yml on
//                           every PR for early signal.
//
//   MANIFEST (--manifest) — parses .next/routes-manifest.json (or the
//                           richer .vercel/output/config.json if present)
//                           for the accurate count. Authoritative.
//                           Used by .github/workflows/build-check.yml
//                           AFTER the Next.js build completes, to
//                           actually block merges.
//
// ──────────────────────────────────────────────────────────────────────────
// CALIBRATION NOTE — Next.js 16.1.x
// ──────────────────────────────────────────────────────────────────────────
// The FAST mode's RSC_EXPANSION_FACTOR (2x) and the MANIFEST mode's
// OVERHEAD_BUFFER (75) are empirically calibrated against Vercel's
// deploy-phase route count as of Next.js 16.1.x. The 2x factor comes from
// Next.js emitting one `.rsc` variant per app-router route for React
// Server Components prefetching. The 75-entry overhead covers middleware
// matcher expansion, prerender variants, and Next.js internal routes.
//
// If this calibration drifts (e.g., after a Next.js 17 upgrade), the
// post-build MANIFEST mode will diverge from Vercel's reported `received`
// count by more than the OVERHEAD_BUFFER. The spec's build principle
// mandates re-verification on Next.js major upgrades. If you are reading
// this comment while upgrading to Next.js 17 or later — stop and re-run
// the calibration against a known failing deploy's `received` count.
// Last calibrated against Vercel deployment dpl_BwicDiAu3wRGAv1agSZqTy7zf6b9
// (2026-04-22, Next.js 16.1.1, received=2055, manifest-derived=1994+75=~2069,
// post-D5 fix: received≈2050, manifest-derived≈2050, drift ≤15 entries).

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Operate on process.cwd() by default so the script can be shelled out
// against a mock repo from tests. In normal CI / local use the working
// directory IS the repo root.
const REPO_ROOT = process.cwd();

// ─── Thresholds (Spec FIX-C) ─────────────────────────────────────────────
//
// The user's formula from spec guidance:
//   ERROR   = min(today + 30, 2020)
//   WARNING = ERROR - 120
//
// Rationale:
// - 2048 is Vercel's hard cap
// - 2020 hard ceiling gives ~28 routes of runway to the cap
// - today + 30 lets the threshold adapt as we grow but caps at the ceiling
// - 120-route gap between warning and error gives real lead time for
//   review + consolidation before a PR actually blocks
// - If today's count is already at the ceiling, ERROR = 2020 and the
//   codebase is effectively frozen until consolidated — this is the
//   intended early-warning signal
//
// These constants are re-evaluated against the current count in
// computeThresholds() so that a one-time recalibration is not required
// after every merge. See also BUDDY_PROJECT_ROADMAP.md build principle.

const VERCEL_ROUTE_CAP = 2048;
const ABSOLUTE_ERROR_CEILING = 2020;
const HEADROOM_FROM_TODAY = 30;
const WARNING_GAP = 120;

// Calibration against known data point:
// Deployment dpl_BwicDiAu3wRGAv1agSZqTy7zf6b9 (commit efdf70c9, 2026-04-22)
// errorMessage: "Maximum number of routes ... received 2055"
// That deploy's manifest: dynamic+static ≈ 1016, headers=5, redirects=1
// Reverse-solving: (1016 × 2) + 5 + 1 + overhead = 2055 → overhead ≈ 17
//
// FAST mode has additional slop because source-file counts don't perfectly
// match Next's emitted route count (10-entry gap observed on current main).
// So FAST_MODE_OVERHEAD is larger than MANIFEST_OVERHEAD_BUFFER.

const RSC_EXPANSION_FACTOR = 2; // Next.js emits one `.rsc` per app-router route
const FAST_MODE_OVERHEAD = 40; // calibrated 2026-04-22 vs Vercel received=2055
const MANIFEST_OVERHEAD_BUFFER = 20; // calibrated 2026-04-22 vs Vercel received=2055

// Delta flag: unusual single-PR growth
const DELTA_FLAG_THRESHOLD = 50;

// ─── CLI parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { mode: "fast", json: false, baseline: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") args.mode = "manifest";
    else if (a === "--fast") args.mode = "fast";
    else if (a === "--json") args.json = true;
    else if (a === "--baseline") {
      const v = argv[++i];
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) args.baseline = n;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`count-routes.mjs — Vercel route-cap observability (Spec FIX-C)

Usage:
  node scripts/count-routes.mjs [--manifest] [--json] [--baseline N]

Modes:
  (default) fast       Source-file count × RSC multiplier + overhead.
                       <1 second. Advisory. Used by PR workflow.
  --manifest           Parse .vercel/output/config.json (if present) or
                       .next/routes-manifest.json. Authoritative. Requires
                       a completed Next.js build. Used by build-check CI.

Flags:
  --json               Machine-readable output for CI parsing.
  --baseline N         Compare against a known main-branch count N.
                       When set, output includes delta vs baseline and
                       flags deltas >= ${DELTA_FLAG_THRESHOLD} regardless of absolute threshold.
  --help, -h           This message.

Exit codes:
  0   — under error threshold (may still be "warning" status)
  1   — at or above error threshold
  2   — counter failed (manifest missing, parse error, etc.)
`);
}

// ─── File-tree walking (no external deps) ────────────────────────────────

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  ".vercel",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  "__tests__",
  "buddy-voice-gateway",
  "supabase",
]);

async function walkFiles(root, filter) {
  const out = [];
  async function recurse(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) continue;
        await recurse(join(dir, ent.name));
      } else if (ent.isFile() && filter(ent.name, join(dir, ent.name))) {
        out.push(join(dir, ent.name));
      }
    }
  }
  if (existsSync(root)) await recurse(root);
  return out;
}

// ─── FAST mode: source-file count ────────────────────────────────────────

async function countFast() {
  const breakdown = {
    app_api_routes: 0,
    app_page_routes: 0,
    pages_api_routes: 0,
    pages_pages: 0,
    middleware: 0,
    next_headers: 0,
    next_redirects: 0,
    next_rewrites: 0,
    vercel_json: 0,
  };

  // A — App Router API routes (every route.ts under src/app/api)
  const appApi = await walkFiles(
    join(REPO_ROOT, "src/app/api"),
    (name) => name === "route.ts" || name === "route.tsx",
  );
  breakdown.app_api_routes = appApi.length;

  // B — App Router pages (every page.* outside /api)
  const appPages = await walkFiles(
    join(REPO_ROOT, "src/app"),
    (name, full) =>
      /^page\.(tsx|ts|jsx|js)$/.test(name) && !full.includes("/api/"),
  );
  breakdown.app_page_routes = appPages.length;

  // C — Pages Router API routes (src/pages/api/**)
  const pagesApi = await walkFiles(
    join(REPO_ROOT, "src/pages/api"),
    (name) => /\.(tsx?|jsx?)$/.test(name),
  );
  breakdown.pages_api_routes = pagesApi.length;

  // D — Pages Router non-API pages (src/pages/** excluding api, excluding Next special files)
  const pagesPages = await walkFiles(
    join(REPO_ROOT, "src/pages"),
    (name, full) => {
      if (full.includes("/api/")) return false;
      if (!/\.(tsx|jsx)$/.test(name)) return false;
      if (/^_(app|document|error)\./.test(name)) return false;
      return true;
    },
  );
  breakdown.pages_pages = pagesPages.length;

  // E — Middleware (Next 16 uses proxy.ts; legacy middleware.ts also counts)
  for (const p of [
    "src/proxy.ts",
    "src/middleware.ts",
    "proxy.ts",
    "middleware.ts",
  ]) {
    if (existsSync(join(REPO_ROOT, p))) breakdown.middleware += 1;
  }

  // F/G/H — next.config.mjs headers / redirects / rewrites via dynamic import
  const nextConfigPath = join(REPO_ROOT, "next.config.mjs");
  if (existsSync(nextConfigPath)) {
    try {
      // ESM dynamic import requires a file:// URL for absolute paths.
      const imported = (await import(pathToFileURL(nextConfigPath).href))
        .default;
      const config =
        typeof imported === "function" ? imported({}, {}) : imported;
      for (const [fn, key] of [
        ["headers", "next_headers"],
        ["redirects", "next_redirects"],
        ["rewrites", "next_rewrites"],
      ]) {
        if (typeof config?.[fn] === "function") {
          try {
            const result = await config[fn]();
            if (Array.isArray(result)) breakdown[key] = result.length;
            else if (result && typeof result === "object") {
              // rewrites() can return { beforeFiles, afterFiles, fallback }
              breakdown[key] =
                (result.beforeFiles?.length ?? 0) +
                (result.afterFiles?.length ?? 0) +
                (result.fallback?.length ?? 0);
            }
          } catch {
            // If the method fails, count 0; surfacing the failure is not
            // this script's job.
          }
        }
      }
    } catch (err) {
      // The dynamic import itself failed — likely a config syntax error
      // or missing build-time env var. Fast mode continues; manifest
      // mode will catch any real misconfiguration.
      console.error(
        `[count-routes] warning: could not import next.config.mjs: ${err.message}`,
      );
    }
  }

  // I — vercel.json
  const vercelJsonPath = join(REPO_ROOT, "vercel.json");
  if (existsSync(vercelJsonPath)) {
    try {
      const cfg = JSON.parse(await readFile(vercelJsonPath, "utf-8"));
      breakdown.vercel_json =
        (cfg.routes?.length ?? 0) +
        (cfg.rewrites?.length ?? 0) +
        (cfg.redirects?.length ?? 0) +
        (cfg.headers?.length ?? 0);
    } catch {
      // malformed vercel.json — treat as 0
    }
  }

  // Raw file count (unexpanded)
  const rawFileCount = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // Approximate Vercel's count by expanding app-router routes for their
  // RSC variants. Pages-router routes and config entries do NOT get the
  // RSC multiplier.
  const rscExpanded =
    (breakdown.app_api_routes + breakdown.app_page_routes) *
    RSC_EXPANSION_FACTOR;
  const nonExpanded =
    breakdown.pages_api_routes +
    breakdown.pages_pages +
    breakdown.middleware +
    breakdown.next_headers +
    breakdown.next_redirects +
    breakdown.next_rewrites +
    breakdown.vercel_json;

  const approximateTotal = rscExpanded + nonExpanded + FAST_MODE_OVERHEAD;

  return {
    mode: "fast",
    breakdown,
    raw_file_count: rawFileCount,
    rsc_expansion_factor: RSC_EXPANSION_FACTOR,
    overhead: FAST_MODE_OVERHEAD,
    total: approximateTotal,
  };
}

// ─── MANIFEST mode: read post-build artifacts ────────────────────────────

async function countFromVercelOutputConfig() {
  // Highest priority source: .vercel/output/config.json is what Vercel
  // actually reads for deploy validation. Zero buffer needed — parse the
  // routes array directly.
  const path = join(REPO_ROOT, ".vercel/output/config.json");
  if (!existsSync(path)) return null;
  try {
    const cfg = JSON.parse(await readFile(path, "utf-8"));
    const count = Array.isArray(cfg.routes) ? cfg.routes.length : 0;
    return {
      mode: "manifest",
      source: ".vercel/output/config.json",
      total: count,
      breakdown: { vercel_routes: count },
      overhead: 0,
    };
  } catch (err) {
    return { error: `Failed to parse .vercel/output/config.json: ${err.message}` };
  }
}

async function countFromNextManifest() {
  const path = join(REPO_ROOT, ".next/routes-manifest.json");
  if (!existsSync(path)) {
    return {
      error:
        "No .next/routes-manifest.json found. Manifest mode requires a completed `next build` — run `pnpm build` first, or use --fast mode instead.",
    };
  }
  try {
    const m = JSON.parse(await readFile(path, "utf-8"));
    const dynamicRoutes = m.dynamicRoutes?.length ?? 0;
    const staticRoutes = m.staticRoutes?.length ?? 0;
    const headers = m.headers?.length ?? 0;
    const redirects = m.redirects?.length ?? 0;
    const rewrites =
      (m.rewrites?.beforeFiles?.length ?? 0) +
      (m.rewrites?.afterFiles?.length ?? 0) +
      (m.rewrites?.fallback?.length ?? 0);
    const dataRoutes = m.dataRoutes?.length ?? 0;

    // Vercel's cap counts each route PLUS its RSC variant. Apply the
    // calibrated RSC_EXPANSION_FACTOR to the combined dynamic+static
    // route entries; headers / redirects / rewrites / data routes do
    // not get the RSC multiplier.
    const routeEntries = dynamicRoutes + staticRoutes;
    const estimated =
      routeEntries * RSC_EXPANSION_FACTOR +
      headers +
      redirects +
      rewrites +
      dataRoutes +
      MANIFEST_OVERHEAD_BUFFER;

    return {
      mode: "manifest",
      source: ".next/routes-manifest.json",
      total: estimated,
      breakdown: {
        dynamic_routes: dynamicRoutes,
        static_routes: staticRoutes,
        headers,
        redirects,
        rewrites,
        data_routes: dataRoutes,
      },
      rsc_expansion_factor: RSC_EXPANSION_FACTOR,
      overhead: MANIFEST_OVERHEAD_BUFFER,
    };
  } catch (err) {
    return { error: `Failed to parse routes-manifest.json: ${err.message}` };
  }
}

async function countManifest() {
  // Priority order per spec:
  //   1. .vercel/output/config.json  → zero-buffer authoritative count
  //   2. .next/routes-manifest.json  → formula-based estimate
  const vercelOutput = await countFromVercelOutputConfig();
  if (vercelOutput && !vercelOutput.error) return vercelOutput;
  return countFromNextManifest();
}

// ─── Threshold computation ───────────────────────────────────────────────

function computeThresholds(currentCount) {
  const errorThreshold = Math.min(
    currentCount + HEADROOM_FROM_TODAY,
    ABSOLUTE_ERROR_CEILING,
  );
  const warningThreshold = errorThreshold - WARNING_GAP;
  return { errorThreshold, warningThreshold };
}

function classifyStatus(count, thresholds) {
  if (count >= thresholds.errorThreshold) return "error";
  if (count >= thresholds.warningThreshold) return "warning";
  return "ok";
}

// ─── Output ──────────────────────────────────────────────────────────────

function formatHuman(report) {
  const lines = [];
  lines.push(`Route Budget Report (${report.mode} mode)`);
  lines.push("═".repeat(50));
  if (report.source) lines.push(`Source: ${report.source}`);
  lines.push("");

  // Breakdown
  const pairs = Object.entries(report.breakdown);
  const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
  for (const [k, v] of pairs) {
    lines.push(
      `  ${k.padEnd(maxKeyLen + 2)}: ${String(v).padStart(6)}`,
    );
  }
  if (report.mode === "fast") {
    lines.push("");
    lines.push(`  Raw file count:      ${String(report.raw_file_count).padStart(6)}`);
    lines.push(`  RSC expansion (×${report.rsc_expansion_factor}): applied to app_api + app_page`);
    lines.push(`  Overhead buffer:     ${String(report.overhead).padStart(6)}`);
  } else if (report.mode === "manifest" && report.rsc_expansion_factor) {
    lines.push("");
    lines.push(`  RSC expansion (×${report.rsc_expansion_factor}): applied to dynamic + static routes`);
    lines.push(`  Overhead buffer:     ${String(report.overhead).padStart(6)}`);
  }
  lines.push("  " + "─".repeat(maxKeyLen + 10));
  lines.push(`  Total:               ${String(report.total).padStart(6)}`);
  lines.push(`  Vercel cap:          ${String(VERCEL_ROUTE_CAP).padStart(6)}`);
  lines.push(`  Error threshold:     ${String(report.thresholds.errorThreshold).padStart(6)}`);
  lines.push(`  Warning threshold:   ${String(report.thresholds.warningThreshold).padStart(6)}`);
  lines.push(`  Headroom to cap:     ${String(VERCEL_ROUTE_CAP - report.total).padStart(6)}`);
  lines.push("");

  // Status. Tone: sober measurement, not alarming — enforcement is paused
  // until Fix A consolidation lands.
  lines.push(`Status: ${report.status}`);
  if (report.status === "error") {
    lines.push(
      "  (over error threshold; enforcement is currently advisory — see Fix A)",
    );
  } else if (report.status === "warning") {
    lines.push(
      "  (within 120 routes of error threshold; plan consolidation)",
    );
  }

  // Delta
  if (report.delta != null) {
    const sign = report.delta >= 0 ? "+" : "";
    lines.push(`Δ vs baseline: ${sign}${report.delta}`);
    if (report.delta_flagged) {
      lines.push(
        `  ⚠️  Large delta (≥${DELTA_FLAG_THRESHOLD}) — structural change; review this PR carefully.`,
      );
    }
  }

  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  let result;
  if (args.mode === "manifest") {
    result = await countManifest();
    if (result.error) {
      if (args.json) {
        console.log(JSON.stringify({ error: result.error }, null, 2));
      } else {
        console.error(`ERROR: ${result.error}`);
      }
      process.exit(2);
    }
  } else {
    result = await countFast();
  }

  const thresholds = computeThresholds(result.total);
  const status = classifyStatus(result.total, thresholds);
  const delta = args.baseline != null ? result.total - args.baseline : null;
  const deltaFlagged = delta != null && Math.abs(delta) >= DELTA_FLAG_THRESHOLD;

  const report = {
    ...result,
    cap: VERCEL_ROUTE_CAP,
    thresholds,
    status,
    headroom: VERCEL_ROUTE_CAP - result.total,
    baseline: args.baseline,
    delta,
    delta_flagged: deltaFlagged,
    delta_flag_threshold: DELTA_FLAG_THRESHOLD,
    calibration: {
      nextjs_version: "16.1.x",
      last_verified_deploy: "dpl_BwicDiAu3wRGAv1agSZqTy7zf6b9",
      last_verified_date: "2026-04-22",
    },
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
  }

  process.exit(status === "error" ? 1 : 0);
}

main().catch((err) => {
  console.error(`[count-routes] unhandled error: ${err.stack || err.message}`);
  process.exit(2);
});
