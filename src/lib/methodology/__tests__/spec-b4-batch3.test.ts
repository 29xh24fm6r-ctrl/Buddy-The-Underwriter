/**
 * SPEC-B4 Batch 3 — Banker-facing surfaces source-level guards.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// ── V-22: methodology_explained kind registered ───────────────────────────

test("[spec-b4-v22] CockpitAdvisorSignalKind includes methodology_explained + PRIORITY_FLOOR entry", () => {
  const body = read("src/lib/journey/advisor/buildCockpitAdvisorSignals.ts");
  assert.match(body, /"methodology_explained"/, "Must include methodology_explained in kind union");
  assert.match(
    body,
    /methodology_explained:\s*350/,
    "PRIORITY_FLOOR must have methodology_explained at 350",
  );
});

// ── V-23: buildMethodologyExplanations function exists ────────────────────

test("[spec-b4-v23] buildMethodologyExplanations function emits signals per non-default axis", () => {
  const body = read("src/lib/journey/advisor/buildCockpitAdvisorSignals.ts");
  assert.match(body, /function buildMethodologyExplanations\b/, "Must declare buildMethodologyExplanations");
  assert.match(
    body,
    /href:\s*`\/deals\/\$\{input\.dealId\}\/methodology`/,
    "Methodology signal action must navigate to picker route",
  );
  assert.match(
    body,
    /kind:\s*"methodology_explained"/,
    "Must emit methodology_explained kind",
  );
});

// ── V-24: methodologyContext input field threaded into builder ────────────

test("[spec-b4-v24] BuildCockpitAdvisorSignalsInput accepts methodologyContext", () => {
  const body = read("src/lib/journey/advisor/buildCockpitAdvisorSignals.ts");
  assert.match(body, /methodologyContext\?:/, "Input type must accept optional methodologyContext");
  assert.match(
    body,
    /buildMethodologyExplanations\s*\(\s*input\s*\)/,
    "Main entry must invoke buildMethodologyExplanations",
  );
});

// ── V-25: GlobalCashFlowSection has optional methodology field ────────────

test("[spec-b4-v25] GlobalCashFlowSection has optional methodology field", () => {
  const body = read("src/lib/classicSpread/types.ts");
  assert.match(body, /methodology\?:\s*Array</, "Must add optional methodology array to GlobalCashFlowSection");
  assert.match(body, /axisId:/, "Methodology entry type must include axisId");
  assert.match(body, /chosenVariantId:/, "Methodology entry must include chosenVariantId");
  assert.match(body, /rationale:/, "Methodology entry must include rationale");
});

// ── V-26: renderMethodologyBlock function exists in renderer ──────────────

test("[spec-b4-v26] classicSpreadRenderer has renderMethodologyBlock function and calls it", () => {
  const body = read("src/lib/classicSpread/classicSpreadRenderer.ts");
  assert.match(body, /function renderMethodologyBlock\b/, "Must declare renderMethodologyBlock");
  assert.match(
    body,
    /renderMethodologyBlock\s*\(/,
    "Must invoke renderMethodologyBlock (inside renderGlobalCashFlowPage)",
  );
  assert.match(
    body,
    /m\.axisId\s*!==\s*"living_expense"/,
    "Methodology block must skip Axis 5 (living_expense) in PDF",
  );
});

// ── V-27: CreditMemoBindings has methodology field + populated ────────────

test("[spec-b4-v27] CreditMemoBindings.methodology declared and populated", () => {
  const typesBody = read("src/lib/creditMemo/bindings.ts");
  assert.match(typesBody, /methodology\?:/, "Type must declare optional methodology field");
  assert.match(typesBody, /cfaMethodologyRationale:/, "Must declare cfaMethodologyRationale binding");
  assert.match(typesBody, /ebitdaMethodologyRationale:/, "Must declare ebitdaMethodologyRationale binding");
  assert.match(typesBody, /officerCompMethodologyRationale:/, "Must declare officerCompMethodologyRationale binding");
  assert.match(typesBody, /gcfMethodologyRationale:/, "Must declare gcfMethodologyRationale binding");

  const buildBody = read("src/lib/creditMemo/buildBindings.ts");
  assert.match(
    buildBody,
    /extractMethodologyRationale/,
    "buildBindings must define methodology extraction helper",
  );
  assert.match(buildBody, /provenance\?\.methodology/, "Must read provenance.methodology from facts");
  assert.match(buildBody, /methodology,/, "Must include methodology in return object");
});

// ── V-28: picker page exists ──────────────────────────────────────────────

test("[spec-b4-v28] picker page and client component exist", () => {
  const candidates = [
    "src/app/(app)/deals/[dealId]/methodology/page.tsx",
    "src/app/(banker)/deals/[dealId]/methodology/page.tsx",
    "src/app/deals/[dealId]/methodology/page.tsx",
  ];
  const pagePath = candidates.find((p) => existsSync(join(REPO_ROOT, p)));
  assert.ok(pagePath, `Picker page must exist at one of: ${candidates.join(", ")}`);

  const pageBody = readFileSync(join(REPO_ROOT, pagePath!), "utf8");
  assert.match(pageBody, /ensureDealBankAccess/, "Picker page must auth via ensureDealBankAccess");
  assert.match(pageBody, /loadDealMethodology/, "Picker page must load methodology");
  assert.match(pageBody, /MethodologyPickerClient/, "Picker page must render client component");

  const dir = pagePath!.replace(/page\.tsx$/, "");
  const clientPath = join(REPO_ROOT, dir, "MethodologyPickerClient.tsx");
  assert.ok(existsSync(clientPath), "MethodologyPickerClient.tsx must exist");
});

// ── V-29: picker POSTs to methodology API ─────────────────────────────────

test("[spec-b4-v29] picker client posts to /api/deals/[dealId]/methodology", () => {
  const candidates = [
    "src/app/(app)/deals/[dealId]/methodology/MethodologyPickerClient.tsx",
    "src/app/(banker)/deals/[dealId]/methodology/MethodologyPickerClient.tsx",
    "src/app/deals/[dealId]/methodology/MethodologyPickerClient.tsx",
  ];
  const clientPath = candidates.find((p) => existsSync(join(REPO_ROOT, p)));
  assert.ok(clientPath, `Picker client must exist at one of: ${candidates.join(", ")}`);

  const body = readFileSync(join(REPO_ROOT, clientPath!), "utf8");
  assert.match(
    body,
    /fetch\s*\(\s*`\/api\/deals\/\$\{props\.dealId\}\/methodology`/,
    "Client must POST to /api/deals/[dealId]/methodology",
  );
  assert.match(body, /method:\s*"POST"/, "Must use POST method");
  assert.match(body, /axis,\s*variant/, "Body must include axis + variant");
});

// ── V-30: cockpit caller wires methodologyContext into the advisor builder ─

test("[spec-b4-v30] cockpit advisor caller passes methodologyContext to builder", () => {
  const CALLER_PATH = "src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx";

  assert.ok(existsSync(join(REPO_ROOT, CALLER_PATH)), `Caller file must exist at: ${CALLER_PATH}`);

  const body = readFileSync(join(REPO_ROOT, CALLER_PATH), "utf8");

  // Evidence (a): one of two loading patterns
  const hasServerLoad = /from\s+["']@\/lib\/methodology\/loadDealMethodology["']/.test(body);
  const hasClientFetch = /fetch\s*\([^)]*\/api\/deals\/[^)]*\/methodology/.test(body);
  assert.ok(
    hasServerLoad || hasClientFetch,
    "Caller must load methodology server-side (loadDealMethodology import) or client-side (fetch to /api/deals/.../methodology)",
  );

  // Evidence (b): methodologyContext literal appears
  assert.match(
    body,
    /methodologyContext/,
    "Caller must reference methodologyContext (the property name passed to the advisor builder)",
  );
});
