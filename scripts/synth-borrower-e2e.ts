#!/usr/bin/env tsx
/**
 * Synthetic borrower end-to-end runner.
 *
 * Spec: SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.7.
 *
 * For each fixture transcript:
 *   1. Fresh cookie jar.
 *   2. Multi-turn POST /api/brokerage/concierge until response reports
 *      `nextRequiredFields = []` or transcript exhausts.
 *   3. POST /api/brokerage/upload/prepare.
 *   4. Poll GET /api/brokerage/deals/{dealId}/seal-status every 5s, up
 *      to 5 minutes.
 *
 * Writes .ci/synth-borrower-e2e-report.json. Exits non-zero if pass_rate
 * drops below 13/15.
 *
 * Env:
 *   BUDDY_PREVIEW_URL          required base URL (e.g. https://preview-xyz.vercel.app)
 *   SUPABASE_SERVICE_ROLE_KEY  required for any backstop queries (unused in v1)
 *   SYNTH_FIXTURE_COUNT        optional cap, default = all fixtures
 *   SYNTH_POLL_INTERVAL_MS     optional, default 5000
 *   SYNTH_POLL_MAX_ATTEMPTS    optional, default 60
 *
 * Real concierge model. Real OCR. No DB surgery.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

type Fixture = { fixture_id: string; transcript: string[] };
type FixtureResult = {
  fixture_id: string;
  deal_id: string | null;
  sealed: boolean;
  elapsed_ms: number;
  last_event: { scope: string; action: string; created_at: string } | null;
  error: string | null;
};

const REQUIRED_PASS_NUMERATOR = 13;
const REQUIRED_PASS_DENOMINATOR = 15;

function env(name: string, required = true): string {
  const v = process.env[name];
  if (required && !v) {
    console.error(`Missing required env: ${name}`);
    process.exit(2);
  }
  return v ?? "";
}

function fixtureDir(): string {
  return join(process.cwd(), "scripts/synth-borrower-e2e/fixtures");
}

function loadFixtures(): Fixture[] {
  const dir = fixtureDir();
  if (!existsSync(dir)) {
    throw new Error(`fixture dir missing: ${dir}`);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const cap = Number(process.env.SYNTH_FIXTURE_COUNT ?? files.length);
  return files
    .slice(0, cap)
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture);
}

function captureSetCookieJar(headers: Headers): string {
  const setCookies = (headers as any).getSetCookie?.() ?? [];
  return setCookies
    .map((sc: string) => sc.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function runFixture(
  baseUrl: string,
  fixture: Fixture,
): Promise<FixtureResult> {
  const started = Date.now();
  let cookieJar = "";
  let dealId: string | null = null;
  let nextRequired: string[] = [];

  // Turn-by-turn concierge until either:
  //   - nextRequiredFields == []
  //   - transcript exhausted
  for (const message of fixture.transcript) {
    const res = await fetch(`${baseUrl}/api/brokerage/concierge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookieJar ? { cookie: cookieJar } : {}),
      },
      body: JSON.stringify({ userMessage: message }),
    });
    if (!res.ok) {
      return {
        fixture_id: fixture.fixture_id,
        deal_id: dealId,
        sealed: false,
        elapsed_ms: Date.now() - started,
        last_event: null,
        error: `concierge_${res.status}`,
      };
    }
    const cookieAddendum = captureSetCookieJar(res.headers);
    if (cookieAddendum) cookieJar = cookieAddendum;
    const body = (await res.json()) as {
      dealId?: string;
      nextRequiredFields?: string[];
    };
    if (body.dealId) dealId = body.dealId;
    nextRequired = body.nextRequiredFields ?? nextRequired;
    if (nextRequired.length === 0) break;
  }

  if (!dealId) {
    return {
      fixture_id: fixture.fixture_id,
      deal_id: null,
      sealed: false,
      elapsed_ms: Date.now() - started,
      last_event: null,
      error: "no_deal_id_after_concierge",
    };
  }

  // Mint an upload link (idempotent — repeat call returns same token).
  const prep = await fetch(`${baseUrl}/api/brokerage/upload/prepare`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieJar,
    },
  });
  if (!prep.ok) {
    return {
      fixture_id: fixture.fixture_id,
      deal_id: dealId,
      sealed: false,
      elapsed_ms: Date.now() - started,
      last_event: null,
      error: `upload_prepare_${prep.status}`,
    };
  }

  // Poll seal status.
  const intervalMs = Number(process.env.SYNTH_POLL_INTERVAL_MS ?? 5000);
  const maxAttempts = Number(process.env.SYNTH_POLL_MAX_ATTEMPTS ?? 60);
  let sealed = false;
  for (let i = 0; i < maxAttempts; i++) {
    const sealRes = await fetch(
      `${baseUrl}/api/brokerage/deals/${dealId}/seal-status`,
      { headers: { cookie: cookieJar } },
    );
    if (sealRes.ok) {
      const sb = (await sealRes.json()) as { sealed?: boolean; status?: string };
      if (sb.sealed || sb.status === "sealed") {
        sealed = true;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    fixture_id: fixture.fixture_id,
    deal_id: dealId,
    sealed,
    elapsed_ms: Date.now() - started,
    last_event: null,
    error: sealed ? null : "seal_timeout",
  };
}

async function main(): Promise<void> {
  const baseUrl = env("BUDDY_PREVIEW_URL").replace(/\/$/, "");
  env("SUPABASE_SERVICE_ROLE_KEY"); // presence check; not used in v1 runner

  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found in scripts/synth-borrower-e2e/fixtures/");
    process.exit(2);
  }
  console.log(`[synth-borrower-e2e] running ${fixtures.length} fixtures against ${baseUrl}`);

  const results: FixtureResult[] = [];
  for (const f of fixtures) {
    console.log(`  → ${f.fixture_id}`);
    const r = await runFixture(baseUrl, f);
    results.push(r);
    console.log(
      `    sealed=${r.sealed} elapsed=${r.elapsed_ms}ms error=${r.error ?? "—"}`,
    );
  }

  const passed = results.filter((r) => r.sealed).length;
  const passRate = passed / results.length;

  const report = {
    ran_at: new Date().toISOString(),
    baseline_commit: process.env.GITHUB_SHA ?? "local",
    base_url: baseUrl,
    pass_count: passed,
    total: results.length,
    pass_rate: passRate,
    threshold: `${REQUIRED_PASS_NUMERATOR}/${REQUIRED_PASS_DENOMINATOR}`,
    fixtures: results,
  };

  const outDir = join(process.cwd(), ".ci");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "synth-borrower-e2e-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[synth-borrower-e2e] report → ${outPath}`);
  console.log(`[synth-borrower-e2e] pass_rate=${passed}/${results.length}`);

  const minPass = REQUIRED_PASS_NUMERATOR / REQUIRED_PASS_DENOMINATOR;
  if (passRate < minPass) {
    console.error(
      `[synth-borrower-e2e] FAIL — pass_rate ${passRate} < threshold ${minPass}`,
    );
    process.exit(1);
  }
  console.log("[synth-borrower-e2e] OK");
}

main().catch((e) => {
  console.error("[synth-borrower-e2e] unexpected error:", e);
  process.exit(2);
});
