// scripts/__tests__/count-routes.test.mjs
// Spec FIX-C — Unit tests for the route-count observability script.
//
// Runs under `node --import tsx --test`. No React/DOM — pure function
// tests against the script's internal helpers and the CLI's JSON output
// against known inputs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Helpers ─────────────────────────────────────────────────────────────

function runScript(args = [], { cwd, env } = {}) {
  const scriptPath = new URL("../count-routes.mjs", import.meta.url).pathname;
  try {
    const stdout = execSync(`node ${scriptPath} ${args.join(" ")}`, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

function scaffoldMockRepo(files) {
  const dir = join(tmpdir(), `count-routes-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

// ─── Threshold math ──────────────────────────────────────────────────────
//
// Can't import the script (it runs main() on import). Instead, shell out
// with --json and verify thresholds are computed from the reported total.

describe("threshold computation — formula: ERROR = min(total + 30, 2020), WARNING = ERROR - 120", () => {
  it("low total (50): ERROR = 80, WARNING = -40", () => {
    // Scaffold an empty repo (no route files at all)
    const repo = scaffoldMockRepo({
      "src/app/page.tsx": "export default function P() { return null; }",
    });
    try {
      const { stdout } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      // With one app_page_route (x2) + 75 overhead = 77 — close enough
      assert.ok(r.total > 0 && r.total < 200, `expected small total, got ${r.total}`);
      assert.equal(r.thresholds.errorThreshold, Math.min(r.total + 30, 2020));
      assert.equal(
        r.thresholds.warningThreshold,
        r.thresholds.errorThreshold - 120,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("at ceiling: ERROR caps at 2020 regardless of total+30", () => {
    // Simulate a high total — we can't easily get there with a mock tree
    // without generating thousands of files. Instead, verify the math
    // directly via a script invocation on a repo with just enough files
    // to push the formula's total+30 past 2020.
    //
    // We use the script's `--json` output against a synthesized
    // vercel.json "routes" array of 2000 entries → total ≈ 2000 + 75 overhead
    // = 2075. ERROR = min(2075 + 30, 2020) = 2020.
    const mockRoutes = Array.from({ length: 2000 }, (_, i) => ({
      src: `/route-${i}`,
    }));
    const repo = scaffoldMockRepo({
      "vercel.json": JSON.stringify({ routes: mockRoutes }),
    });
    try {
      const { stdout } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.ok(
        r.total >= 2000,
        `expected total near 2075, got ${r.total}`,
      );
      assert.equal(
        r.thresholds.errorThreshold,
        2020,
        "error ceiling must cap at 2020",
      );
      assert.equal(r.thresholds.warningThreshold, 1900);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// ─── Status classification ───────────────────────────────────────────────

describe("status classification", () => {
  it("status=error when total >= errorThreshold", () => {
    const mockRoutes = Array.from({ length: 2000 }, (_, i) => ({
      src: `/r-${i}`,
    }));
    const repo = scaffoldMockRepo({
      "vercel.json": JSON.stringify({ routes: mockRoutes }),
    });
    try {
      const { stdout, status } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      // total ~2075, ERROR=2020, total > ERROR → status=error, exit code=1
      assert.equal(r.status, "error");
      assert.equal(status, 1, "exit code must be 1 at error threshold");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("status is not 'error' for tiny mock repos (exit code 0)", () => {
    // The threshold formula (ERROR = min(total+30, 2020), WARNING = ERROR-120)
    // is calibrated for realistic production totals (~1500-2050 range). For
    // tiny mock repos, WARNING can compute below the total and status can
    // be "warning" even at a count of 77. That is acceptable — what matters
    // is that tiny repos never produce a blocking "error" state.
    const repo = scaffoldMockRepo({
      "src/app/page.tsx": "export default function P(){return null;}",
    });
    try {
      const { stdout, status } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.notEqual(r.status, "error");
      assert.equal(status, 0);
      assert.ok(r.total < 200, `mock repo should have small total, got ${r.total}`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// ─── Fast-mode file counting ─────────────────────────────────────────────

describe("fast mode — source file counting", () => {
  it("counts App Router API routes (route.ts under src/app/api)", () => {
    const repo = scaffoldMockRepo({
      "src/app/api/deals/route.ts": "export async function GET(){}",
      "src/app/api/deals/[id]/route.ts": "export async function GET(){}",
      "src/app/api/other/route.ts": "export async function POST(){}",
    });
    try {
      const { stdout } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.equal(r.breakdown.app_api_routes, 3);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("counts dynamic segments [id] and catch-all [...path] as one route each", () => {
    const repo = scaffoldMockRepo({
      "src/app/api/x/[id]/route.ts": "export async function GET(){}",
      "src/app/api/y/[...path]/route.ts": "export async function GET(){}",
    });
    try {
      const { stdout } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.equal(r.breakdown.app_api_routes, 2);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("ignores layout.tsx, loading.tsx, error.tsx, not-found.tsx", () => {
    const repo = scaffoldMockRepo({
      "src/app/page.tsx": "export default function(){return null;}",
      "src/app/layout.tsx": "export default function(){return null;}",
      "src/app/loading.tsx": "export default function(){return null;}",
      "src/app/error.tsx": "export default function(){return null;}",
      "src/app/not-found.tsx": "export default function(){return null;}",
      "src/app/global-error.tsx": "export default function(){return null;}",
    });
    try {
      const { stdout } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      // Only page.tsx should count
      assert.equal(r.breakdown.app_page_routes, 1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("counts src/pages/api/ files (legacy pages router)", () => {
    const repo = scaffoldMockRepo({
      "src/pages/api/a.ts": "export default function(){}",
      "src/pages/api/b/c.ts": "export default function(){}",
      "src/pages/api/d.tsx": "export default function(){}",
    });
    try {
      const { stdout } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.equal(r.breakdown.pages_api_routes, 3);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("counts src/pages/**/*.tsx but excludes _app/_document/_error special files", () => {
    const repo = scaffoldMockRepo({
      "src/pages/index.tsx": "export default function(){}",
      "src/pages/about.tsx": "export default function(){}",
      "src/pages/_app.tsx": "export default function(){}",
      "src/pages/_document.tsx": "export default function(){}",
      "src/pages/_error.tsx": "export default function(){}",
    });
    try {
      const { stdout } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.equal(r.breakdown.pages_pages, 2);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("counts middleware — src/proxy.ts (Next 16) or src/middleware.ts (legacy)", () => {
    const repo1 = scaffoldMockRepo({
      "src/proxy.ts": "export function middleware(){}",
    });
    try {
      const r1 = JSON.parse(runScript(["--json"], { cwd: repo1 }).stdout);
      assert.equal(r1.breakdown.middleware, 1);
    } finally {
      rmSync(repo1, { recursive: true, force: true });
    }

    const repo2 = scaffoldMockRepo({
      "src/middleware.ts": "export function middleware(){}",
    });
    try {
      const r2 = JSON.parse(runScript(["--json"], { cwd: repo2 }).stdout);
      assert.equal(r2.breakdown.middleware, 1);
    } finally {
      rmSync(repo2, { recursive: true, force: true });
    }
  });

  it("parses next.config.mjs headers() array length", () => {
    const repo = scaffoldMockRepo({
      "next.config.mjs": `
        export default {
          async headers() {
            return [
              { source: "/a", headers: [] },
              { source: "/b", headers: [] },
              { source: "/c", headers: [] },
            ];
          }
        };
      `,
    });
    try {
      const { stdout } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.equal(r.breakdown.next_headers, 3);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// ─── Delta tracking ──────────────────────────────────────────────────────

describe("delta tracking against baseline", () => {
  it("reports delta when --baseline is provided", () => {
    const repo = scaffoldMockRepo({
      "src/app/page.tsx": "export default function(){}",
    });
    try {
      const { stdout } = runScript(["--json", "--baseline", "100"], {
        cwd: repo,
      });
      const r = JSON.parse(stdout);
      assert.equal(r.baseline, 100);
      assert.equal(typeof r.delta, "number");
      assert.equal(r.delta, r.total - 100);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("flags delta >= 50", () => {
    const mockRoutes = Array.from({ length: 80 }, (_, i) => ({ src: `/r${i}` }));
    const repo = scaffoldMockRepo({
      "vercel.json": JSON.stringify({ routes: mockRoutes }),
    });
    try {
      // baseline=0 → delta = total (well over 50) → flagged
      const { stdout } = runScript(["--json", "--baseline", "0"], {
        cwd: repo,
      });
      const r = JSON.parse(stdout);
      assert.equal(r.delta_flagged, true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("does not flag small deltas (< 50)", () => {
    const repo = scaffoldMockRepo({
      "src/app/page.tsx": "export default function(){}",
    });
    try {
      // baseline ≈ total ± small — not flagged
      const { stdout } = runScript(["--json"], { cwd: repo });
      const initial = JSON.parse(stdout).total;
      const { stdout: stdout2 } = runScript(
        ["--json", "--baseline", String(initial - 10)],
        { cwd: repo },
      );
      const r = JSON.parse(stdout2);
      assert.equal(r.delta, 10);
      assert.equal(r.delta_flagged, false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("delta is null when --baseline not provided", () => {
    const repo = scaffoldMockRepo({
      "src/app/page.tsx": "export default function(){}",
    });
    try {
      const { stdout } = runScript(["--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.equal(r.baseline, null);
      assert.equal(r.delta, null);
      assert.equal(r.delta_flagged, false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// ─── Manifest mode ───────────────────────────────────────────────────────

describe("manifest mode", () => {
  it("reports error when no manifest exists", () => {
    const repo = scaffoldMockRepo({});
    try {
      const { status, stdout } = runScript(["--manifest", "--json"], {
        cwd: repo,
      });
      assert.equal(status, 2, "exit code 2 when manifest missing");
      const r = JSON.parse(stdout);
      assert.ok(r.error);
      assert.match(r.error, /manifest/i);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("reads .next/routes-manifest.json and applies RSC multiplier + overhead", () => {
    const manifest = {
      version: 3,
      dynamicRoutes: Array.from({ length: 100 }, (_, i) => ({
        page: `/d/${i}`,
      })),
      staticRoutes: Array.from({ length: 50 }, (_, i) => ({ page: `/s/${i}` })),
      headers: [{ source: "/a" }, { source: "/b" }],
      redirects: [{ source: "/r", destination: "/x" }],
      rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
      dataRoutes: [],
    };
    const repo = scaffoldMockRepo({
      ".next/routes-manifest.json": JSON.stringify(manifest),
    });
    try {
      const { stdout } = runScript(["--manifest", "--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.equal(r.mode, "manifest");
      assert.equal(r.source, ".next/routes-manifest.json");
      // Expected: 150 routes × 2 (RSC) + 2 headers + 1 redirect + 0 rewrites
      //   + MANIFEST_OVERHEAD_BUFFER (20, calibrated 2026-04-22 vs efdf70c9 received=2055)
      // = 300 + 2 + 1 + 0 + 20 = 323
      assert.equal(r.total, 323);
      assert.equal(r.breakdown.dynamic_routes, 100);
      assert.equal(r.breakdown.static_routes, 50);
      assert.equal(r.breakdown.headers, 2);
      assert.equal(r.breakdown.redirects, 1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("prefers .vercel/output/config.json when present (zero-buffer authoritative)", () => {
    const routes = Array.from({ length: 123 }, (_, i) => ({ src: `/r${i}` }));
    const repo = scaffoldMockRepo({
      ".vercel/output/config.json": JSON.stringify({ routes }),
      // A routes-manifest exists too but should be ignored
      ".next/routes-manifest.json": JSON.stringify({
        dynamicRoutes: Array.from({ length: 999 }, (_, i) => ({
          page: `/x${i}`,
        })),
        staticRoutes: [],
        headers: [],
        redirects: [],
        rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
        dataRoutes: [],
      }),
    });
    try {
      const { stdout } = runScript(["--manifest", "--json"], { cwd: repo });
      const r = JSON.parse(stdout);
      assert.equal(r.source, ".vercel/output/config.json");
      // Zero-buffer authoritative — total should be exactly 123
      assert.equal(r.total, 123);
      assert.equal(r.overhead, 0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// ─── Exit-code contract ──────────────────────────────────────────────────

describe("exit codes", () => {
  it("exit 0 when under error threshold", () => {
    const repo = scaffoldMockRepo({
      "src/app/page.tsx": "export default function(){}",
    });
    try {
      const { status } = runScript(["--json"], { cwd: repo });
      assert.equal(status, 0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("exit 1 at or above error threshold", () => {
    const mockRoutes = Array.from({ length: 2000 }, (_, i) => ({
      src: `/r${i}`,
    }));
    const repo = scaffoldMockRepo({
      "vercel.json": JSON.stringify({ routes: mockRoutes }),
    });
    try {
      const { status } = runScript(["--json"], { cwd: repo });
      assert.equal(status, 1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("exit 2 on counter error (missing manifest)", () => {
    const repo = scaffoldMockRepo({});
    try {
      const { status } = runScript(["--manifest", "--json"], { cwd: repo });
      assert.equal(status, 2);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
