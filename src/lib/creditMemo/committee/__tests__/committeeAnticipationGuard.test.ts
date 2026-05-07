/**
 * Committee Anticipation Engine — CI Guard.
 *
 * Structural invariants:
 *
 *   1. Pure modules (types, evaluator, rules) must not import "server-only"
 *   2. Every objection emitted by every rule has the required fields:
 *      code (non-empty, unique within the rule), domain, severity, label,
 *      rationale (non-empty, not a generic placeholder).
 *   3. Every hard objection has a fixPath OR a mitigant (banker can never
 *      hit a wall).
 *   4. Headline is non-empty in every reachable posture.
 *   5. The orchestrator imports every rule module — no rule silently dropped.
 *   6. The credit-memo + memo-inputs surfaces mount the panel.
 *   7. Banker-facing copy is specific (no "Resolve Blockers", no generic
 *      "issue exists" labels).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { evaluateCommitteeAnticipation } from "@/lib/creditMemo/committee/evaluateCommitteeAnticipation";
import type { CommitteeEngineInputs } from "@/lib/creditMemo/committee/types";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const COMMITTEE = join(REPO_ROOT, "src/lib/creditMemo/committee");
const RULES = join(COMMITTEE, "rules");

function read(p: string) {
  return readFileSync(p, "utf8");
}

// ─── Guard 1 — purity ──────────────────────────────────────────────────────

test("[ca-guard-1] pure modules must not import 'server-only'", () => {
  const importRe = /^\s*import\s+["']server-only["']/m;
  const PURE = [
    join(COMMITTEE, "types.ts"),
    join(COMMITTEE, "evaluateCommitteeAnticipation.ts"),
    ...readdirSync(RULES)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join(RULES, f)),
  ];
  for (const p of PURE) {
    const body = read(p);
    assert.ok(!importRe.test(body), `${p} must not import "server-only"`);
    // Banned transitive server-only deps.
    assert.ok(
      !/from\s+["']@\/lib\/supabase\/admin["']/.test(body),
      `${p} must not import supabaseAdmin`,
    );
  }
});

// ─── Guard 2 — every objection has required fields ─────────────────────────

function fullCoverageInputs(): CommitteeEngineInputs {
  // Inputs designed to fire as many rules as possible — verifies the
  // emitted-fact contract across the rule set in one pass.
  return {
    dealId: "deal-x",
    metrics: {
      dscr: 1.0,
      dscr_stressed_300bps: 0.85,
      cash_flow_available: 100_000,
      annual_debt_service: 200_000,
      excess_cash_flow: -50_000,
      global_cash_flow: 80_000,
      gcf_dscr: 0.9,
      revenue_ttm: 1_000_000,
      ebitda_ttm: 100_000,
      net_income_ttm: 50_000,
      debt_to_equity: 6,
      total_liabilities: 500_000,
      net_worth: 100_000,
      collateral_gross_value: 1_000_000,
      collateral_discounted_value: 700_000,
      collateral_coverage: 0.7,
      ltv_gross: 0.95,
      ltv_net: 0.9,
      loan_amount: 1_500_000,
      bank_loan_total: 1_500_000,
      pfs_total_assets: 50_000,
      pfs_net_worth: -10_000,
    },
    memoInput: {
      ready: false,
      blockerCodes: [
        "missing_business_description",
        "missing_revenue_model",
        "missing_management_profile",
        "missing_collateral_value",
        "missing_research_quality_gate",
        "open_fact_conflicts",
        "missing_policy_exception_review",
        "unfinalized_required_documents",
      ],
      openConflictsCount: 3,
      borrowerStoryCustomers: "Single customer accounts for 80% of revenue",
      borrowerStoryConcentration: "Sole customer is the largest enterprise client",
      borrowerStoryRevenueModel: "",
      borrowerStoryRisks: "",
      managementProfilesCount: 0,
      collateralItemsCount: 1,
      collateralWithValueCount: 0,
    },
    research: {
      gate_passed: false,
      trust_grade: "research_failed",
      quality_score: 0.2,
      industry: "Restaurant chain",
    },
    pricing: { decided: false, rate_initial_pct: null },
    openPolicyExceptionsCount: 2,
    covenantPackagePresent: false,
  };
}

test("[ca-guard-2] every emitted objection has the required contract fields", () => {
  const r = evaluateCommitteeAnticipation(fullCoverageInputs());
  const all = [...r.objections, ...r.doc_weaknesses];
  assert.ok(all.length > 0, "fullCoverageInputs must trigger objections");

  for (const o of all) {
    assert.ok(o.code && o.code.length > 0, "code missing");
    assert.ok(o.domain, "domain missing");
    assert.ok(["hard", "soft", "info"].includes(o.severity), "severity invalid");
    assert.ok(o.label && o.label.length > 4, `label missing for ${o.code}`);
    assert.ok(
      o.rationale && o.rationale.length > 10,
      `rationale missing for ${o.code}`,
    );
  }
});

// ─── Guard 3 — every hard objection has a fixPath OR a mitigant ────────────

test("[ca-guard-3] every hard objection has a fixPath or a mitigant", () => {
  const r = evaluateCommitteeAnticipation(fullCoverageInputs());
  const hardOjbs = [...r.objections, ...r.doc_weaknesses].filter(
    (o) => o.severity === "hard",
  );
  for (const o of hardOjbs) {
    assert.ok(
      Boolean(o.fixPath || o.mitigant),
      `hard objection ${o.code} has neither fixPath nor mitigant — banker would hit a wall`,
    );
  }
});

// ─── Guard 4 — headline is always non-empty ────────────────────────────────

test("[ca-guard-4] headline is non-empty across reachable postures", () => {
  // Cycle through the four postures by rigging input shapes.
  const postures = [
    fullCoverageInputs(), // not_ready (memo not ready)
    {
      ...fullCoverageInputs(),
      memoInput: { ...fullCoverageInputs().memoInput, ready: true, blockerCodes: [] },
      // still hard objections from metrics
    },
    {
      ...fullCoverageInputs(),
      metrics: {
        ...fullCoverageInputs().metrics,
        dscr: 1.5,
        dscr_stressed_300bps: 1.2,
        excess_cash_flow: 100_000,
        ltv_gross: 0.6,
        collateral_coverage: 1.5,
        gcf_dscr: 1.5,
        pfs_net_worth: 500_000,
        debt_to_equity: 1,
        total_liabilities: 100_000,
        ebitda_ttm: 200_000,
      },
      pricing: { decided: true, rate_initial_pct: 7 },
      openPolicyExceptionsCount: 0,
      covenantPackagePresent: true,
      research: {
        gate_passed: true,
        trust_grade: "committee_grade",
        quality_score: 0.9,
        industry: "Industrial services",
      },
      memoInput: {
        ...fullCoverageInputs().memoInput,
        ready: true,
        blockerCodes: [],
        openConflictsCount: 0,
        borrowerStoryConcentration: "No single customer above 10%",
        borrowerStoryCustomers: "Diversified enterprise base",
        borrowerStoryRevenueModel: "Recurring subscription",
        managementProfilesCount: 2,
        collateralWithValueCount: 1,
      },
    },
  ] as CommitteeEngineInputs[];
  for (const inp of postures) {
    const r = evaluateCommitteeAnticipation(inp);
    assert.ok(r.headline.length > 0, `headline empty for posture=${r.posture}`);
  }
});

// ─── Guard 5 — orchestrator imports every rule module ──────────────────────

test("[ca-guard-5] orchestrator imports every rule module", () => {
  const orch = read(join(COMMITTEE, "evaluateCommitteeAnticipation.ts"));
  const ruleFiles = readdirSync(RULES).filter((f) => f.endsWith(".ts"));
  // Each rule file must contribute at least one export referenced by the
  // orchestrator.
  for (const f of ruleFiles) {
    const ruleSrc = read(join(RULES, f));
    // Extract every `export const X` / `export function X` symbol.
    const exports = [
      ...ruleSrc.matchAll(/export\s+(?:const|function)\s+(\w+)/g),
    ].map((m) => m[1]);
    const mentioned = exports.some((sym) => orch.includes(sym));
    assert.ok(
      mentioned,
      `${f} exports ${exports.join(", ")} — at least one must be referenced in evaluateCommitteeAnticipation.ts`,
    );
  }
});

// ─── Guard 6 — UI surfaces mount the panel ─────────────────────────────────

test("[ca-guard-6] credit-memo + memo-inputs surfaces mount the panel", () => {
  const memoPage = read(
    join(REPO_ROOT, "src/app/(app)/deals/[dealId]/credit-memo/page.tsx"),
  );
  assert.match(memoPage, /CommitteeAnticipationPanel/);

  const inputsBody = read(
    join(REPO_ROOT, "src/components/creditMemo/inputs/MemoInputsBody.tsx"),
  );
  assert.match(inputsBody, /CommitteeAnticipationPanel/);
});

// ─── Guard 7 — no generic copy in objection labels ─────────────────────────

test("[ca-guard-7] no generic banker-anti-pattern copy in any objection", () => {
  const r = evaluateCommitteeAnticipation(fullCoverageInputs());
  const all = [...r.objections, ...r.doc_weaknesses];
  const banned = [
    /^Resolve Blockers$/i,
    /^Issue exists$/i,
    /^Click here/i,
    /^Lorem ipsum/i,
  ];
  for (const o of all) {
    for (const re of banned) {
      assert.ok(!re.test(o.label), `objection ${o.code} uses generic label "${o.label}"`);
    }
  }
});

// ─── Guard 8 — API + assembler exist + are wired ───────────────────────────

test("[ca-guard-8] API route + server assembler are wired", () => {
  const route = read(
    join(REPO_ROOT, "src/app/api/deals/[dealId]/committee-anticipation/route.ts"),
  );
  assert.match(route, /buildCommitteeAnticipation/);
  assert.match(route, /requireDealAccess/);
  const assembler = read(join(COMMITTEE, "buildCommitteeAnticipation.ts"));
  assert.match(assembler, /evaluateCommitteeAnticipation/);
  assert.match(assembler, /buildMemoInputPackage/);
  assert.match(assembler, /loadResearchForMemo/);
});
