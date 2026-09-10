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
 *   4. GET /api/brokerage/deals/{dealId}/seal-status and verify the
 *      readiness contract. This journey does not upload a document package
 *      or invoke POST /seal, so an unsealed response with explicit gate
 *      reasons is the truthful expected state.
 *
 * Writes .ci/synth-borrower-e2e-report.json. Exits non-zero if pass_rate
 * drops below 13/15.
 *
 * Env:
 *   BUDDY_BASE_URL             optional base URL; defaults to production
 *   GitHub Actions OIDC        required to classify test data and persist evidence
 *   SYNTH_FIXTURE_COUNT        optional cap, default = all fixtures
 *
 * Real concierge model. Real OCR. No DB surgery.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { detectRepeatAsks } from "./synth-borrower-e2e/detectRepeatAsks";
import { getGitHubActionsOidcToken } from "./lib/github-actions-oidc";

type Fixture = { fixture_id: string; transcript: string[] };
type FixtureResult = {
  fixture_id: string;
  deal_id: string | null;
  sealed: boolean;
  status_verified: boolean;
  can_seal: boolean | null;
  gate_reasons: string[];
  elapsed_ms: number;
  last_event: { scope: string; action: string; created_at: string } | null;
  error: string | null;
  // SPEC-M2 BEAT-METRICS-1: repeat_ask_count regression — fields the
  // concierge asked for again after they'd already been satisfied earlier
  // in the same transcript. Non-empty means a covenant violation.
  repeat_asked_fields: string[];
};

const REQUIRED_PASS_NUMERATOR = 13;
const REQUIRED_PASS_DENOMINATOR = 15;

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

async function fetchWithRateLimitPacing(
  request: () => Promise<Response>,
  operation: string,
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request();
    if (response.status !== 429 || attempt === 2) return response;

    const retryAfter = Number(response.headers.get("retry-after") ?? "60");
    const waitSeconds = Math.min(
      Math.max(Number.isFinite(retryAfter) ? retryAfter : 60, 1) + 1,
      65,
    );
    console.log(
      `[synth-borrower-e2e] rate limited; pacing ${operation} for ${waitSeconds}s`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }
  throw new Error("unreachable rate-limit retry state");
}

async function postConciergeWithRateLimitPacing(args: {
  baseUrl: string;
  cookieJar: string;
  userMessage: string;
}): Promise<Response> {
  return fetchWithRateLimitPacing(
    () => fetch(`${args.baseUrl}/api/brokerage/concierge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(args.cookieJar ? { cookie: args.cookieJar } : {}),
      },
      body: JSON.stringify({ userMessage: args.userMessage }),
    }),
    "next turn",
  );
}

async function runFixture(
  baseUrl: string,
  fixture: Fixture,
): Promise<FixtureResult> {
  const started = Date.now();
  let cookieJar = "";
  let dealId: string | null = null;
  let nextRequired: string[] = [];
  const nextRequiredSnapshots: string[][] = [];

  // Turn-by-turn concierge until either:
  //   - nextRequiredFields == []
  //   - transcript exhausted
  for (const message of fixture.transcript) {
    const res = await postConciergeWithRateLimitPacing({
      baseUrl,
      cookieJar,
      userMessage: message,
    });
    if (!res.ok) {
      return {
        fixture_id: fixture.fixture_id,
        deal_id: dealId,
        sealed: false,
        status_verified: false,
        can_seal: null,
        gate_reasons: [],
        elapsed_ms: Date.now() - started,
        last_event: null,
        error: `concierge_${res.status}`,
        repeat_asked_fields: detectRepeatAsks(nextRequiredSnapshots),
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
    nextRequiredSnapshots.push(nextRequired);
    if (nextRequired.length === 0) break;
  }

  // SPEC-M2 BEAT-METRICS-1: check the repeat-ask covenant across the whole
  // transcript before anything else — a violation fails the fixture even
  // if the deal otherwise seals cleanly.
  const repeatAskedFields = detectRepeatAsks(nextRequiredSnapshots);

  if (!dealId) {
    return {
      fixture_id: fixture.fixture_id,
      deal_id: null,
      sealed: false,
      status_verified: false,
      can_seal: null,
      gate_reasons: [],
      elapsed_ms: Date.now() - started,
      last_event: null,
      error: "no_deal_id_after_concierge",
      repeat_asked_fields: repeatAskedFields,
    };
  }

  // Mint an upload link (idempotent — repeat call returns same token).
  const prep = await fetchWithRateLimitPacing(
    () => fetch(`${baseUrl}/api/brokerage/upload/prepare`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieJar,
      },
    }),
    "upload preparation",
  );
  if (!prep.ok) {
    return {
      fixture_id: fixture.fixture_id,
      deal_id: dealId,
      sealed: false,
      status_verified: false,
      can_seal: null,
      gate_reasons: [],
      elapsed_ms: Date.now() - started,
      last_event: null,
      error: `upload_prepare_${prep.status}`,
      repeat_asked_fields: repeatAskedFields,
    };
  }

  const sealRes = await fetch(
    `${baseUrl}/api/brokerage/deals/${dealId}/seal-status`,
    { headers: { cookie: cookieJar } },
  );
  if (!sealRes.ok) {
    return {
      fixture_id: fixture.fixture_id,
      deal_id: dealId,
      sealed: false,
      status_verified: false,
      can_seal: null,
      gate_reasons: [],
      elapsed_ms: Date.now() - started,
      last_event: null,
      error: `seal_status_${sealRes.status}`,
      repeat_asked_fields: repeatAskedFields,
    };
  }
  const status = (await sealRes.json()) as {
    ok?: boolean;
    sealed?: boolean;
    canSeal?: boolean;
    gateReasons?: unknown;
  };
  const gateReasons = Array.isArray(status.gateReasons)
    ? status.gateReasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  const statusVerified =
    status.ok === true &&
    typeof status.sealed === "boolean" &&
    typeof status.canSeal === "boolean" &&
    Array.isArray(status.gateReasons);

  return {
    fixture_id: fixture.fixture_id,
    deal_id: dealId,
    sealed: status.sealed === true,
    status_verified: statusVerified && repeatAskedFields.length === 0,
    can_seal: typeof status.canSeal === "boolean" ? status.canSeal : null,
    gate_reasons: gateReasons,
    elapsed_ms: Date.now() - started,
    last_event: null,
    error: !statusVerified ? "invalid_seal_status_contract" : repeatAskedFields.length > 0 ? "repeat_ask_violation" : null,
    repeat_asked_fields: repeatAskedFields,
  };
}

async function finalizeDurableReport(
  baseUrl: string,
  report: Record<string, unknown>,
  results: FixtureResult[],
  passedGate: boolean,
): Promise<void> {
  const token = await getGitHubActionsOidcToken();
  const legacyIds = (process.env.LEGACY_SYNTHETIC_DEAL_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const dealIds = [...new Set([
    ...results.map((result) => result.deal_id).filter((id): id is string => Boolean(id)),
    ...legacyIds,
  ])];
  const response = await fetch(`${baseUrl}/api/ops/certification/finalize`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ dealIds, report, passedGate }),
  });
  if (!response.ok) {
    throw new Error(`production certification finalization failed: HTTP ${response.status}`);
  }
}

async function main(): Promise<void> {
  const baseUrl = (process.env.BUDDY_BASE_URL ?? "https://app.buddytheunderwriter.com").replace(/\/$/, "");

  // Fail before creating production records if the short-lived workflow
  // identity needed for cleanup/evidence is unavailable.
  await getGitHubActionsOidcToken();

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
      `    status_verified=${r.status_verified} sealed=${r.sealed} can_seal=${r.can_seal} elapsed=${r.elapsed_ms}ms error=${r.error ?? "—"}` +
        (r.repeat_asked_fields.length
          ? ` REPEAT_ASK_VIOLATION=[${r.repeat_asked_fields.join(",")}]`
          : ""),
    );
  }

  const passed = results.filter((r) => r.status_verified).length;
  const passRate = passed / results.length;
  const repeatAskViolations = results.filter((r) => r.repeat_asked_fields.length > 0);

  const report = {
    ran_at: new Date().toISOString(),
    baseline_commit: process.env.GITHUB_SHA ?? "local",
    base_url: baseUrl,
    pass_count: passed,
    total: results.length,
    pass_rate: passRate,
    threshold: `${REQUIRED_PASS_NUMERATOR}/${REQUIRED_PASS_DENOMINATOR}`,
    repeat_ask_violation_count: repeatAskViolations.length,
    fixtures: results,
  };

  const outDir = join(process.cwd(), ".ci");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "synth-borrower-e2e-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[synth-borrower-e2e] report → ${outPath}`);
  console.log(`[synth-borrower-e2e] pass_rate=${passed}/${results.length}`);

  const minPass = REQUIRED_PASS_NUMERATOR / REQUIRED_PASS_DENOMINATOR;
  const passedGate = repeatAskViolations.length === 0 && passRate >= minPass;
  await finalizeDurableReport(baseUrl, report, results, passedGate);
  console.log("[synth-borrower-e2e] synthetic deals classified and durable evidence recorded");

  // SPEC-M2 BEAT-METRICS-1: the repeat-ask covenant is a hard gate,
  // independent of the pass-rate threshold — even one violation fails the
  // run, since this is the one enforcement mechanism the whole program's
  // "never repeat a question" promise rests on.
  if (repeatAskViolations.length > 0) {
    console.error(
      `[synth-borrower-e2e] FAIL — repeat-ask covenant violated in ${repeatAskViolations.length} fixture(s): ` +
        repeatAskViolations.map((r) => `${r.fixture_id}=[${r.repeat_asked_fields.join(",")}]`).join("; "),
    );
    process.exit(1);
  }

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
