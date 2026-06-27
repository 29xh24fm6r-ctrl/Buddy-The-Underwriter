/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 6: Credit Memo engine.
 *
 * The memo is RENDERED from certified analytical objects, section-by-section.
 * It READS conclusions and FORMATS them — it never computes or writes a number
 * (the §2.1 "math drives the memo, the memo never drives the math" wall; G4).
 * Omega may narrate prose into `narrative`; it must not alter a figure (NG1).
 *
 * Pure — no DB, no server-only, NO fact writes.
 */

import type { MetricResult } from "@/lib/finengine/contracts";
import type { RiskRating } from "@/lib/finengine/riskRating";

export type MemoInputs = {
  borrower: { displayName: string; entityForm?: string }; // display_name only (G5)
  request?: { purpose?: string; amount?: number; product?: string };
  sourcesUses?: { sources: Array<{ label: string; amount: number }>; uses: Array<{ label: string; amount: number }> };
  ownershipGuarantors?: Array<{ displayName: string; ownershipPct?: number; isGuarantor?: boolean }>;
  metrics?: MetricResult[];
  globalCashFlow?: { globalDSCR: number | null; globalCashBeforeDebt: number; globalDebtService: number };
  collateral?: { coverageRatio: number | null; shortfall: number; guarantorSupportRequired: boolean };
  sbaFindings?: Array<{ rule: string; status: string; detail: string; citation: string }>;
  riskRating?: RiskRating;
  stress?: Array<{ scenario: string; dscr: number | null; passes: boolean | null }>;
  covenants?: Array<{ name: string; threshold: number | string; note: string }>;
  approvalConditions?: string[];
  /** Marketplace eligibility gate (kept explicit). */
  redactForMarketplace?: boolean;
};

export type MemoSection = { key: string; title: string; body: string; narrative?: string; hasData: boolean };

const money = (n?: number | null): string => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const ratio = (n?: number | null): string => (n == null ? "—" : `${n.toFixed(2)}x`);

function section(key: string, title: string, body: string, hasData: boolean): MemoSection {
  return { key, title, body: hasData ? body : `${title}: data not yet available.`, hasData };
}

/**
 * Build the full memo from certified objects. Returns ordered sections. NEVER
 * mutates inputs and NEVER writes facts.
 */
export function buildCreditMemo(input: MemoInputs): { sections: MemoSection[]; marketplaceRedacted: boolean } {
  const m = input.metrics ?? [];
  const findMetric = (name: string) => m.find((x) => x.metric === name);

  const sections: MemoSection[] = [];

  sections.push(section("exec_summary", "Executive Summary",
    `${input.borrower.displayName} requests ${money(input.request?.amount)} (${input.request?.product ?? "facility"}). ` +
    `Recommended risk grade ${input.riskRating?.recommendedGrade ?? "—"} (${input.riskRating?.classification ?? "—"}); ` +
    `global DSCR ${ratio(input.globalCashFlow?.globalDSCR)}.`,
    true));

  sections.push(section("borrower_background", "Borrower Background",
    `${input.borrower.displayName}${input.borrower.entityForm ? ` (${input.borrower.entityForm})` : ""}.`, true));

  sections.push(section("request_purpose", "Request & Purpose",
    `${input.request?.purpose ?? "—"} — ${money(input.request?.amount)}.`, !!input.request));

  sections.push(section("sources_uses", "Sources & Uses",
    input.sourcesUses
      ? `Sources: ${input.sourcesUses.sources.map((s) => `${s.label} ${money(s.amount)}`).join(", ")}. ` +
        `Uses: ${input.sourcesUses.uses.map((u) => `${u.label} ${money(u.amount)}`).join(", ")}.`
      : "", !!input.sourcesUses));

  sections.push(section("ownership_guarantors", "Ownership & Guarantors",
    (input.ownershipGuarantors ?? []).map((o) => `${o.displayName}${o.ownershipPct != null ? ` (${(o.ownershipPct * 100).toFixed(0)}%)` : ""}${o.isGuarantor ? " — guarantor" : ""}`).join("; "),
    !!input.ownershipGuarantors?.length));

  sections.push(section("management", "Management", "Management assessment to be supplied by analyst narrative.", false));
  sections.push(section("industry", "Industry", "Industry analysis to be supplied by research module.", false));

  sections.push(section("repayment", "Primary Repayment — Cash Flow",
    `DSCR ${ratio(findMetric("DSCR")?.value)} (floor ${ratio(findMetric("DSCR")?.policyApplied?.effective)}, ${findMetric("DSCR")?.passesFloor ? "PASS" : "REVIEW"}).`,
    !!findMetric("DSCR")));

  sections.push(section("global_cash_flow", "Global Cash Flow",
    `Global cash available ${money(input.globalCashFlow?.globalCashBeforeDebt)} ÷ global debt service ${money(input.globalCashFlow?.globalDebtService)} = ${ratio(input.globalCashFlow?.globalDSCR)}.`,
    !!input.globalCashFlow));

  sections.push(section("collateral", "Collateral",
    `Coverage ${ratio(input.collateral?.coverageRatio)}; shortfall ${money(input.collateral?.shortfall)}${input.collateral?.guarantorSupportRequired ? " — guarantor support required" : ""}.`,
    !!input.collateral));

  sections.push(section("sba_eligibility", "SBA Eligibility",
    (input.sbaFindings ?? []).map((f) => `${f.rule}: ${f.status} (${f.citation})`).join("; "),
    !!input.sbaFindings?.length));

  sections.push(section("policy_exceptions", "Policy Exceptions",
    (input.sbaFindings ?? []).filter((f) => f.status === "FAIL" || f.status === "EXCEPTION").map((f) => `${f.rule}: ${f.detail}`).join("; ") || "None identified.",
    true));

  sections.push(section("risk_rating", "Risk-Rating Support",
    (input.riskRating?.rationale ?? []).join(" "), !!input.riskRating));

  sections.push(section("stress", "Stress Testing",
    (input.stress ?? []).map((s) => `${s.scenario}: ${ratio(s.dscr)} (${s.passes ? "pass" : "fail"})`).join("; "),
    !!input.stress?.length));

  sections.push(section("covenants", "Covenant Package",
    (input.covenants ?? []).map((c) => `${c.name} ${typeof c.threshold === "number" ? c.threshold : c.threshold}: ${c.note}`).join("; "),
    !!input.covenants?.length));

  sections.push(section("swot", "Strengths / Weaknesses / Mitigants", "Analyst narrative; mitigants tied to the conditions below.", false));

  sections.push(section("approval_conditions", "Approval Conditions",
    (input.approvalConditions ?? []).map((c, i) => `${i + 1}. ${c}`).join(" "), !!input.approvalConditions?.length));

  sections.push(section("monitoring", "Monitoring", "Ongoing covenant and collateral monitoring per the package above.", !!input.covenants?.length));

  sections.push(section("recommendation", "Recommendation",
    `${input.riskRating?.classification === "PASS" ? "Approve" : "Approve with conditions / escalate"} at grade ${input.riskRating?.recommendedGrade ?? "—"}, subject to the conditions herein.`,
    !!input.riskRating));

  return { sections, marketplaceRedacted: !!input.redactForMarketplace };
}
