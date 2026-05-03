import "server-only";

/**
 * Conversation → SBA assumptions extractor.
 *
 * Pulls borrower-quoted numbers (units/month, gross-per-unit, bay counts,
 * payroll line items, working capital reserves, planned hires, named
 * principals, etc.) out of `borrower_concierge_sessions.conversation_history`
 * and emits a `Partial<SBAAssumptions>` that can be layered between the
 * existing draft row and the NAICS-driven prefill in `buildCandidate`.
 *
 * Hard rules:
 *   1. NEVER fabricate numbers. Every output field is null unless the
 *      borrower stated it (or it is directly computable from two stated
 *      numbers — e.g. units/month × gross-per-unit × 12 → annual revenue).
 *   2. Verbatim evidence is captured per field so an auditor can trace
 *      "this $3.15M came from this borrower utterance."
 *   3. The extractor returns null on Gemini failure / missing API key.
 *      The caller falls back to prior layers (prefill / defaults). The
 *      bootstrap path stays usable even when Gemini is unavailable.
 *
 * Why not regex: borrowers describe businesses freely ("we do about 70 to
 * 80 cars a month at thirty-five hundred a unit"). A pattern matcher is
 * brittle here. Gemini Flash with a strict structured-output prompt is the
 * right tool, with the fallback above for resilience.
 */

import type {
  SBAAssumptions,
  RevenueStream,
  FixedCostCategory,
  PlannedHire,
  ManagementMember,
} from "./sbaReadinessTypes";
import { callGeminiJSON } from "@/lib/ai/geminiClient";
import { MODEL_CONCIERGE_EXTRACTION } from "@/lib/ai/models";

export type ConversationMessage = {
  role: "user" | "assistant" | string;
  content: string;
};

export type ConversationExtraction = {
  partial: Partial<SBAAssumptions>;
  evidence: Record<string, string>;
};

export type ConversationExtractionInput = {
  history: ConversationMessage[];
  // Optional injected extractor — used in tests to swap callGeminiJSON.
  callJson?: typeof callGeminiJSON;
};

const SYSTEM_INSTRUCTION = `You convert a borrower-concierge conversation transcript into structured SBA loan assumptions.

ABSOLUTE RULES:
- DO NOT FABRICATE. Every field defaults to null. Only fill a field if the borrower (role="user") stated the number, or if it is the direct product/sum of two numbers the borrower stated (e.g. 18 bays × $10,000/bay = $180,000/month).
- Use the borrower's words, not the assistant's suggestions. If the assistant proposed a number and the borrower agreed (e.g. "yes", "right", "that's correct"), treat it as confirmed.
- Convert monthly figures to annual by multiplying by 12.
- Treat ranges (e.g. "70 to 80 units") as the midpoint.
- For each filled field, capture a short verbatim quote from the transcript as evidence.

OUTPUT JSON SHAPE (return ONLY this JSON, no markdown fences):
{
  "revenueStreams": [ { "name": string, "baseAnnualRevenue": number, "evidence": string } ] | null,
  "costAssumptions": {
    "cogsPercentYear1": number | null,
    "fixedCostCategories": [ { "name": string, "annualAmount": number, "evidence": string } ] | null,
    "plannedHires": [ { "role": string, "annualSalary": number, "headcount": number | null, "evidence": string } ] | null
  } | null,
  "workingCapital": {
    "targetReserveDollars": number | null,
    "evidence": string | null
  } | null,
  "loanImpact": {
    "loanAmount": number | null,
    "termMonths": number | null,
    "interestRate": number | null,
    "monthlyDebtService": number | null,
    "evidence": string | null
  } | null,
  "managementTeam": [ { "name": string, "title": string | null, "evidence": string } ] | null
}`;

export async function extractAssumptionsFromConversation(
  input: ConversationExtractionInput,
): Promise<ConversationExtraction | null> {
  const history = (input.history ?? []).filter(
    (m) => typeof m?.content === "string" && m.content.trim().length > 0,
  );
  if (history.length === 0) return null;

  const transcript = history
    .map((m) => `${m.role.toUpperCase()}: ${String(m.content).trim()}`)
    .join("\n\n");

  const call = input.callJson ?? callGeminiJSON;
  const res = await call<RawExtraction>({
    model: MODEL_CONCIERGE_EXTRACTION,
    logTag: "sba-assumptions-from-conversation",
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: `TRANSCRIPT:\n\n${transcript}\n\nReturn ONLY the JSON object described in the system instruction.`,
  });

  if (!res.ok || !res.result) return null;
  return shapeRawExtraction(res.result);
}

// ── Internal: shape raw model output into Partial<SBAAssumptions> ────────

type RawRevenue = {
  name?: string | null;
  baseAnnualRevenue?: number | null;
  evidence?: string | null;
};
type RawFixedCost = {
  name?: string | null;
  annualAmount?: number | null;
  evidence?: string | null;
};
type RawHire = {
  role?: string | null;
  annualSalary?: number | null;
  headcount?: number | null;
  evidence?: string | null;
};
type RawMgmt = {
  name?: string | null;
  title?: string | null;
  evidence?: string | null;
};

type RawExtraction = {
  revenueStreams?: RawRevenue[] | null;
  costAssumptions?: {
    cogsPercentYear1?: number | null;
    fixedCostCategories?: RawFixedCost[] | null;
    plannedHires?: RawHire[] | null;
  } | null;
  workingCapital?: {
    targetReserveDollars?: number | null;
    evidence?: string | null;
  } | null;
  loanImpact?: {
    loanAmount?: number | null;
    termMonths?: number | null;
    interestRate?: number | null;
    monthlyDebtService?: number | null;
    evidence?: string | null;
  } | null;
  managementTeam?: RawMgmt[] | null;
};

export function shapeRawExtraction(
  raw: RawExtraction,
): ConversationExtraction {
  const partial: Partial<SBAAssumptions> = {};
  const evidence: Record<string, string> = {};

  // Revenue streams
  const rawStreams = (raw.revenueStreams ?? []).filter(
    (s): s is RawRevenue =>
      !!s &&
      typeof s.name === "string" &&
      s.name.trim().length > 0 &&
      typeof s.baseAnnualRevenue === "number" &&
      Number.isFinite(s.baseAnnualRevenue) &&
      s.baseAnnualRevenue > 0,
  );
  if (rawStreams.length > 0) {
    const streams: RevenueStream[] = rawStreams.map((s, i) => ({
      id: `conv_${slugify(s.name!)}_${i}`,
      name: s.name!.trim(),
      baseAnnualRevenue: Math.round(s.baseAnnualRevenue!),
      // Conservative defaults — borrower didn't state growth rates.
      growthRateYear1: 0.05,
      growthRateYear2: 0.04,
      growthRateYear3: 0.03,
      pricingModel: "flat",
      seasonalityProfile: null,
    }));
    partial.revenueStreams = streams;
    rawStreams.forEach((s, i) => {
      if (s.evidence) evidence[`revenueStreams[${i}]`] = s.evidence;
    });
  }

  // Cost assumptions
  const rawCost = raw.costAssumptions ?? null;
  if (rawCost) {
    const costPartial: Partial<SBAAssumptions["costAssumptions"]> = {};
    if (
      typeof rawCost.cogsPercentYear1 === "number" &&
      Number.isFinite(rawCost.cogsPercentYear1) &&
      rawCost.cogsPercentYear1 > 0 &&
      rawCost.cogsPercentYear1 < 1
    ) {
      // Borrower-quoted COGS — fan to all three years (no growth-curve
      // signal in the transcript). Caller can override per year if they
      // later capture more detail.
      costPartial.cogsPercentYear1 = rawCost.cogsPercentYear1;
      costPartial.cogsPercentYear2 = rawCost.cogsPercentYear1;
      costPartial.cogsPercentYear3 = rawCost.cogsPercentYear1;
    }
    const rawFixed = (rawCost.fixedCostCategories ?? []).filter(
      (c): c is RawFixedCost =>
        !!c &&
        typeof c.name === "string" &&
        c.name.trim().length > 0 &&
        typeof c.annualAmount === "number" &&
        Number.isFinite(c.annualAmount) &&
        c.annualAmount > 0,
    );
    if (rawFixed.length > 0) {
      const fixed: FixedCostCategory[] = rawFixed.map((c) => ({
        name: c.name!.trim(),
        annualAmount: Math.round(c.annualAmount!),
        escalationPctPerYear: 0.03,
      }));
      costPartial.fixedCostCategories = fixed;
      rawFixed.forEach((c, i) => {
        if (c.evidence)
          evidence[`costAssumptions.fixedCostCategories[${i}]`] = c.evidence;
      });
    }
    const rawHires = (rawCost.plannedHires ?? []).filter(
      (h): h is RawHire =>
        !!h &&
        typeof h.role === "string" &&
        h.role.trim().length > 0 &&
        typeof h.annualSalary === "number" &&
        Number.isFinite(h.annualSalary) &&
        h.annualSalary > 0,
    );
    if (rawHires.length > 0) {
      const hires: PlannedHire[] = [];
      rawHires.forEach((h) => {
        const headcount = Math.max(1, Math.round(h.headcount ?? 1));
        for (let n = 0; n < headcount; n++) {
          hires.push({
            role: h.role!.trim(),
            startMonth: 1,
            annualSalary: Math.round(h.annualSalary!),
          });
        }
      });
      costPartial.plannedHires = hires;
      rawHires.forEach((h, i) => {
        if (h.evidence)
          evidence[`costAssumptions.plannedHires[${i}]`] = h.evidence;
      });
    }
    if (Object.keys(costPartial).length > 0) {
      partial.costAssumptions = {
        cogsPercentYear1: costPartial.cogsPercentYear1 ?? 0,
        cogsPercentYear2: costPartial.cogsPercentYear2 ?? 0,
        cogsPercentYear3: costPartial.cogsPercentYear3 ?? 0,
        fixedCostCategories: costPartial.fixedCostCategories ?? [],
        plannedHires: costPartial.plannedHires ?? [],
        plannedCapex: [],
      };
    }
  }

  // Working capital — borrower-quoted reserves don't map cleanly to DSO/DPO
  // but we capture the dollar reserve as evidence. The actual targetDSO /
  // targetDPO numbers stay sourced from prefill (NAICS medians).
  const rawWC = raw.workingCapital ?? null;
  if (
    rawWC &&
    typeof rawWC.targetReserveDollars === "number" &&
    Number.isFinite(rawWC.targetReserveDollars) &&
    rawWC.targetReserveDollars > 0 &&
    rawWC.evidence
  ) {
    evidence["workingCapital.targetReserveDollars"] = rawWC.evidence;
  }

  // Loan impact
  const rawLI = raw.loanImpact ?? null;
  if (rawLI) {
    const liPartial: Partial<SBAAssumptions["loanImpact"]> = {};
    if (
      typeof rawLI.loanAmount === "number" &&
      Number.isFinite(rawLI.loanAmount) &&
      rawLI.loanAmount > 0
    ) {
      liPartial.loanAmount = Math.round(rawLI.loanAmount);
    }
    if (
      typeof rawLI.termMonths === "number" &&
      Number.isFinite(rawLI.termMonths) &&
      rawLI.termMonths > 0
    ) {
      liPartial.termMonths = Math.round(rawLI.termMonths);
    }
    if (
      typeof rawLI.interestRate === "number" &&
      Number.isFinite(rawLI.interestRate) &&
      rawLI.interestRate > 0 &&
      rawLI.interestRate < 1
    ) {
      liPartial.interestRate = rawLI.interestRate;
    }
    if (
      typeof rawLI.monthlyDebtService === "number" &&
      Number.isFinite(rawLI.monthlyDebtService) &&
      rawLI.monthlyDebtService > 0
    ) {
      liPartial.existingDebt = [
        {
          description: "Existing debt service (borrower-stated)",
          currentBalance: 0,
          monthlyPayment: Math.round(rawLI.monthlyDebtService),
          remainingTermMonths: 60,
        },
      ];
    }
    if (Object.keys(liPartial).length > 0) {
      partial.loanImpact = liPartial as SBAAssumptions["loanImpact"];
      if (rawLI.evidence) evidence["loanImpact"] = rawLI.evidence;
    }
  }

  // Management team
  const rawMgmt = (raw.managementTeam ?? []).filter(
    (m): m is RawMgmt =>
      !!m && typeof m.name === "string" && m.name.trim().length > 0,
  );
  if (rawMgmt.length > 0) {
    const team: ManagementMember[] = rawMgmt.map((m) => ({
      name: m.name!.trim(),
      title: m.title?.trim() || "Principal",
      ownershipPct: undefined,
      yearsInIndustry: 0,
      bio: m.evidence?.trim() || "",
    }));
    partial.managementTeam = team;
    rawMgmt.forEach((m, i) => {
      if (m.evidence) evidence[`managementTeam[${i}]`] = m.evidence;
    });
  }

  return { partial, evidence };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "stream";
}
