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
 *   SUPABASE_SERVICE_ROLE_KEY  required to persist durable run evidence
 *   SUPABASE_URL               required (NEXT_PUBLIC_SUPABASE_URL also accepted)
 *   SYNTH_FIXTURE_COUNT        optional cap, default = all fixtures
 *
 * Real concierge model. Real OCR. No DB surgery.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { detectRepeatAsks } from "./synth-borrower-e2e/detectRepeatAsks";

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
  const nextRequiredSnapshots: string[][] = [];

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

async function persistDurableReport(
  report: Record<string, unknown>,
  passedGate: boolean,
): Promise<void> {
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = (
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ""
  ).replace(/\/$/, "");
  if (!supabaseUrl) {
    throw new Error("Missing required env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/ai_events`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      deal_id: null,
      scope: "synth_borrower_e2e",
      action: passedGate ? "passed" : "failed",
      output_json: {
        ran_at: report.ran_at,
        baseline_commit: report.baseline_commit,
        pass_count: report.pass_count,
        total: report.total,
        pass_rate: report.pass_rate,
        threshold: report.threshold,
        repeat_ask_violation_count: report.repeat_ask_violation_count,
      },
      confidence: 1,
      requires_human_review: !passedGate,
    }),
  });
  if (!response.ok) {
    throw new Error(`durable evidence persistence failed: HTTP ${response.status}`);
  }
}

async function classifySyntheticDeals(results: FixtureResult[]): Promise<void> {
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!supabaseUrl) throw new Error("Missing required env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  const dealIds = [...new Set(results.map((result) => result.deal_id).filter((id): id is string => Boolean(id)))];
  for (const dealId of dealIds) {
    const response = await fetch(`${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}`, {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify({ is_test: true }),
    });
    if (!response.ok) throw new Error(`synthetic deal classification failed for ${dealId}: HTTP ${response.status}`);
    const rows = await response.json() as Array<{ id?: string; is_test?: boolean }>;
    if (rows.length !== 1 || rows[0]?.id !== dealId || rows[0]?.is_test !== true) {
      throw new Error(`synthetic deal classification was not confirmed for ${dealId}`);
    }
  }
}

async function main(): Promise<void> {
  const baseUrl = (process.env.BUDDY_BASE_URL ?? "https://app.buddytheunderwriter.com").replace(/\/$/, "");

  // Fail before creating production records if cleanup/evidence credentials
  // are unavailable.
  env("SUPABASE_SERVICE_ROLE_KEY");
  if (!(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error("Missing required env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }

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
  await classifySyntheticDeals(results);
  console.log("[synth-borrower-e2e] synthetic deals classified and excluded from operating totals");
  await persistDurableReport(report, passedGate);
  console.log("[synth-borrower-e2e] durable evidence recorded");

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
