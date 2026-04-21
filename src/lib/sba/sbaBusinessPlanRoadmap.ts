import "server-only";

// src/lib/sba/sbaBusinessPlanRoadmap.ts
// God Tier Business Plan — Step 6
// Three Gemini generators that produce the "roadmap" sections of the plan —
// the pieces that transform the plan from "a document you submit" to "a
// document you USE". All three return structured JSON, not prose. All three
// accept an optional BorrowerStory and plan thesis so the outputs are
// grounded in the borrower's own growth mechanism and named risk. Each
// returns null on failure — callers must tolerate null and omit the section
// rather than displaying a placeholder.

import type { BorrowerStory } from "./sbaBorrowerStory";
import { callGeminiJSON } from "./sbaPackageNarrative";

// ─── Shared helpers ───────────────────────────────────────────────────────

function hasStorySubstance(story: BorrowerStory | null | undefined): boolean {
  if (!story) return false;
  const nonEmpty = (s: string | null) =>
    typeof s === "string" && s.trim().length > 0;
  return (
    nonEmpty(story.originStory) ||
    nonEmpty(story.competitiveInsight) ||
    nonEmpty(story.idealCustomer) ||
    nonEmpty(story.growthStrategy) ||
    nonEmpty(story.biggestRisk) ||
    nonEmpty(story.personalVision)
  );
}

function formatStoryForPrompt(story: BorrowerStory | null | undefined): string {
  if (!hasStorySubstance(story)) return "";
  const s = story as BorrowerStory;
  const lines: string[] = ["BORROWER'S STORY (their own words):"];
  if (s.originStory?.trim()) lines.push(`Origin: ${s.originStory.trim()}`);
  if (s.competitiveInsight?.trim())
    lines.push(`Competitive edge: ${s.competitiveInsight.trim()}`);
  if (s.idealCustomer?.trim())
    lines.push(`Ideal customer: ${s.idealCustomer.trim()}`);
  if (s.growthStrategy?.trim())
    lines.push(`Growth plan: ${s.growthStrategy.trim()}`);
  if (s.biggestRisk?.trim())
    lines.push(`Biggest risk: ${s.biggestRisk.trim()}`);
  if (s.personalVision?.trim())
    lines.push(`Success vision: ${s.personalVision.trim()}`);
  return lines.join("\n") + "\n";
}

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Gemini occasionally wraps JSON in markdown fences despite responseMimeType.
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ─── 1. Milestone Timeline ────────────────────────────────────────────────

export type MilestoneCategory =
  | "funding"
  | "operations"
  | "hiring"
  | "revenue"
  | "growth";

export interface Milestone {
  month: number;
  title: string;
  description: string;
  category: MilestoneCategory;
  successMetric: string;
  tiedToProceeds: boolean;
}

const MILESTONE_CATEGORIES: MilestoneCategory[] = [
  "funding",
  "operations",
  "hiring",
  "revenue",
  "growth",
];

function sanitizeMilestone(raw: unknown): Milestone | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const month = Number(r.month);
  if (!Number.isFinite(month) || month < 1 || month > 36) return null;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (title.length === 0) return null;
  const description =
    typeof r.description === "string" ? r.description.trim() : "";
  const category = MILESTONE_CATEGORIES.includes(
    r.category as MilestoneCategory,
  )
    ? (r.category as MilestoneCategory)
    : "operations";
  const successMetric =
    typeof r.successMetric === "string" ? r.successMetric.trim() : "";
  const tiedToProceeds = r.tiedToProceeds === true;
  return {
    month: Math.round(month),
    title,
    description,
    category,
    successMetric,
    tiedToProceeds,
  };
}

export async function generateMilestoneTimeline(params: {
  dealName: string;
  story: BorrowerStory | null;
  planThesis?: string | null;
  useOfProceeds: Array<{ category: string; description: string; amount: number }>;
  plannedHires: Array<{ role: string; startMonth: number; annualSalary: number }>;
  growthStrategy: string | null;
  projectedRevenueYear1: number;
  projectedRevenueYear2: number;
  loanAmount: number;
}): Promise<Milestone[] | null> {
  const storyBlock = formatStoryForPrompt(params.story);
  const proceedsList = params.useOfProceeds
    .map(
      (p) =>
        `- ${p.category}: ${p.description} ($${Math.round(p.amount).toLocaleString()})`,
    )
    .join("\n");
  const hiresList = params.plannedHires
    .map(
      (h) =>
        `- ${h.role}: start month ${h.startMonth}, $${h.annualSalary.toLocaleString()}/yr`,
    )
    .join("\n");

  const prompt = `You are an SBA business plan writer producing a structured MILESTONE TIMELINE for ${params.dealName}.

REQUIREMENTS:
- Produce between 8 and 12 milestones spanning months 1 to 24.
- Every use-of-proceeds line item must appear as at least one milestone with tiedToProceeds=true.
- Every planned hire must appear as a hiring milestone at its listed start month.
- ${params.growthStrategy ? "Translate the borrower's own growth strategy into 2–4 revenue/growth milestones. Use THEIR named actions (channels, partnerships, customer types) — do not substitute generic tactics." : "Derive revenue/growth milestones from the use-of-proceeds and projected revenue trajectory."}
- Each milestone must include a successMetric the borrower can actually measure (a number, a count, a specific observable event). NOT vague aspirations.
- category must be one of: funding, operations, hiring, revenue, growth.
- month is an integer from 1 to 24.
- Do NOT invent additional hires, equipment items, or partnerships beyond what is provided.

${params.planThesis ? `PLAN THESIS:\n${params.planThesis}\n\n` : ""}${storyBlock}

Use of proceeds:
${proceedsList || "(none provided)"}

Planned hires:
${hiresList || "(none provided)"}

Projected Year 1 revenue: $${Math.round(params.projectedRevenueYear1).toLocaleString()}
Projected Year 2 revenue: $${Math.round(params.projectedRevenueYear2).toLocaleString()}
Loan amount: $${params.loanAmount.toLocaleString()}

Return ONLY valid JSON with this exact shape:
{
  "milestones": [
    {
      "month": 1,
      "title": "string",
      "description": "string (1-2 sentences)",
      "category": "funding|operations|hiring|revenue|growth",
      "successMetric": "string (measurable)",
      "tiedToProceeds": true|false
    }
  ]
}`;

  try {
    const text = await callGeminiJSON(prompt);
    const parsed = tryParseJson<{ milestones?: unknown[] }>(text);
    if (!parsed || !Array.isArray(parsed.milestones)) return null;
    const cleaned = parsed.milestones
      .map(sanitizeMilestone)
      .filter((m): m is Milestone => m !== null)
      .sort((a, b) => a.month - b.month);
    return cleaned.length > 0 ? cleaned : null;
  } catch (err) {
    console.error(
      "[sbaBusinessPlanRoadmap] generateMilestoneTimeline error:",
      err,
    );
    return null;
  }
}

// ─── 2. KPI Dashboard ─────────────────────────────────────────────────────

export type KPIFrequency = "weekly" | "monthly" | "quarterly";

export interface KPITarget {
  name: string;
  description: string;
  frequency: KPIFrequency;
  targetValue: string;
  warningThreshold: string;
  relevance: string;
}

const KPI_FREQUENCIES: KPIFrequency[] = ["weekly", "monthly", "quarterly"];

function sanitizeKpi(raw: unknown): KPITarget | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (name.length === 0) return null;
  const description =
    typeof r.description === "string" ? r.description.trim() : "";
  const frequency = KPI_FREQUENCIES.includes(r.frequency as KPIFrequency)
    ? (r.frequency as KPIFrequency)
    : "monthly";
  const targetValue =
    typeof r.targetValue === "string" ? r.targetValue.trim() : "";
  const warningThreshold =
    typeof r.warningThreshold === "string" ? r.warningThreshold.trim() : "";
  const relevance = typeof r.relevance === "string" ? r.relevance.trim() : "";
  return { name, description, frequency, targetValue, warningThreshold, relevance };
}

export async function generateKPIDashboard(params: {
  dealName: string;
  industryDescription: string;
  naicsCode: string | null;
  story: BorrowerStory | null;
  planThesis?: string | null;
  revenueStreams: Array<{ name: string; baseAnnualRevenue: number }>;
  cogsPercent: number;
  dscrYear1: number;
  monthlyDebtService: number;
  breakEvenRevenue: number;
}): Promise<KPITarget[] | null> {
  const storyBlock = formatStoryForPrompt(params.story);
  const streamsList = params.revenueStreams
    .map(
      (s) =>
        `- ${s.name}: $${Math.round(s.baseAnnualRevenue).toLocaleString()}/yr base`,
    )
    .join("\n");

  const prompt = `You are producing a KPI DASHBOARD for ${params.dealName} — the 5 to 7 numbers the owner should watch to know their business is on track.

REQUIREMENTS:
- Produce 5 to 7 KPIs, no more, no fewer.
- Each KPI must be SPECIFIC to the industry "${params.industryDescription}". Generic KPIs like "monthly revenue" are only acceptable if paired with a truly industry-specific target.
- Derive targetValue from the financial model provided below (NOT from generic benchmarks). Example: if break-even revenue is $X, the monthly revenue target must clearly exceed $X/12.
- warningThreshold must be a specific observable trigger (e.g., "Below $3,800/month for 2 consecutive months" — not "revenue drops").
- relevance must explain WHY this KPI matters to THIS business in one sentence. Plain English, no banking jargon.
- Do NOT use "DSCR" in the KPI name. Say "loan payment coverage" or similar borrower-facing language.
- ${params.story?.idealCustomer ? "If the borrower described their ideal customer, include at least one KPI that tracks that customer type (acquisition rate, retention, per-customer revenue)." : ""}
- ${params.story?.growthStrategy ? "If the borrower's growth strategy names a specific channel or partnership, include a KPI that tracks performance through that channel." : ""}
- frequency must be one of: weekly, monthly, quarterly.

${params.planThesis ? `PLAN THESIS:\n${params.planThesis}\n\n` : ""}${storyBlock}

Industry: ${params.industryDescription}
NAICS: ${params.naicsCode ?? "Not provided"}
Revenue streams:
${streamsList || "(none provided)"}
COGS: ${(params.cogsPercent * 100).toFixed(1)}% of revenue
Year 1 loan-payment coverage (DSCR): ${params.dscrYear1.toFixed(2)}x (SBA minimum 1.25x)
Monthly loan payment: $${Math.round(params.monthlyDebtService).toLocaleString()}
Annual break-even revenue: $${Math.round(params.breakEvenRevenue).toLocaleString()}

Return ONLY valid JSON with this exact shape:
{
  "kpis": [
    {
      "name": "string (borrower-facing, no jargon)",
      "description": "string (what exactly is being measured)",
      "frequency": "weekly|monthly|quarterly",
      "targetValue": "string (with units, derived from model above)",
      "warningThreshold": "string (specific trigger)",
      "relevance": "string (why this matters to this business — 1 sentence)"
    }
  ]
}`;

  try {
    const text = await callGeminiJSON(prompt);
    const parsed = tryParseJson<{ kpis?: unknown[] }>(text);
    if (!parsed || !Array.isArray(parsed.kpis)) return null;
    const cleaned = parsed.kpis
      .map(sanitizeKpi)
      .filter((k): k is KPITarget => k !== null);
    if (cleaned.length < 3) return null;
    return cleaned.slice(0, 7);
  } catch (err) {
    console.error(
      "[sbaBusinessPlanRoadmap] generateKPIDashboard error:",
      err,
    );
    return null;
  }
}

// ─── 3. Risk Contingency Matrix ───────────────────────────────────────────

export type RiskSeverity = "low" | "medium" | "high";

export interface RiskContingency {
  risk: string;
  trigger: string;
  impact: string;
  actions: string[];
  severity: RiskSeverity;
}

const RISK_SEVERITIES: RiskSeverity[] = ["low", "medium", "high"];

function sanitizeRisk(raw: unknown): RiskContingency | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const risk = typeof r.risk === "string" ? r.risk.trim() : "";
  if (risk.length === 0) return null;
  const trigger = typeof r.trigger === "string" ? r.trigger.trim() : "";
  const impact = typeof r.impact === "string" ? r.impact.trim() : "";
  const actionsRaw = Array.isArray(r.actions) ? r.actions : [];
  const actions = actionsRaw
    .filter((a): a is string => typeof a === "string")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  if (actions.length === 0) return null;
  const severity = RISK_SEVERITIES.includes(r.severity as RiskSeverity)
    ? (r.severity as RiskSeverity)
    : "medium";
  return { risk, trigger, impact, actions, severity };
}

export async function generateRiskContingencyMatrix(params: {
  dealName: string;
  story: BorrowerStory | null;
  planThesis?: string | null;
  biggestRisk: string | null; // from BorrowerStory — duplicated for prompt convenience
  dscrYear1: number;
  dscrDownside: number;
  breakEvenRevenue: number;
  projectedRevenueYear1: number;
  monthlyDebtService: number;
  fixedCosts: Array<{ name: string; annualAmount: number }>;
  plannedHires: Array<{ role: string; annualSalary: number }>;
  sensitivityScenarios: Array<{
    name: string;
    dscrYear1: number;
    revenueYear1: number;
  }>;
}): Promise<RiskContingency[] | null> {
  const storyBlock = formatStoryForPrompt(params.story);
  const fixedCostsList = params.fixedCosts
    .map(
      (c) =>
        `- ${c.name}: $${Math.round(c.annualAmount).toLocaleString()}/yr`,
    )
    .join("\n");
  const hiresList = params.plannedHires
    .map(
      (h) =>
        `- ${h.role}: $${h.annualSalary.toLocaleString()}/yr`,
    )
    .join("\n");
  const scenariosList = params.sensitivityScenarios
    .map(
      (s) =>
        `- ${s.name}: DSCR Y1 ${s.dscrYear1.toFixed(2)}x, revenue Y1 $${Math.round(s.revenueYear1).toLocaleString()}`,
    )
    .join("\n");

  const prompt = `You are producing a RISK CONTINGENCY MATRIX for ${params.dealName} — a table of specific risks, specific triggers, and specific actions the owner can execute if a risk materializes.

REQUIREMENTS:
- Produce 3 to 5 risks.
- ${params.biggestRisk?.trim() ? "The FIRST risk MUST be the borrower's own stated biggest risk. Paraphrase into a clear risk statement, then derive the trigger, impact, and actions." : ""}
- Derive the remaining risks from the sensitivity scenarios and the business's actual cost/hire structure.
- trigger MUST be a specific observable threshold with a number: "Monthly revenue below $X for 2 consecutive months", "DSCR drops below 1.10x", "Gross margin falls below X%". Never "revenue drops" or "demand weakens" without a number.
- impact MUST cite a specific dollar or ratio consequence: "Annual cash shortfall of approximately $X", "DSCR drops from Y to Z".
- actions MUST be 2–4 specific, executable, DOLLAR-DENOMINATED contingencies that reference the actual fixed cost line items or planned hires the borrower has listed. Example: "Defer [actual role] hire by 90 days (saves $X)", "Reduce [actual cost line] by 30% (saves $Y/month)". Never "cut costs" or "raise prices" without specificity.
- severity must be one of: low, medium, high.
- Do NOT invent cost line items or hires that are not listed below.

${params.planThesis ? `PLAN THESIS:\n${params.planThesis}\n\n` : ""}${storyBlock}

Borrower's own stated biggest risk: ${params.biggestRisk?.trim() || "(not captured — derive risks from the financial sensitivity)"}

Year 1 DSCR: ${params.dscrYear1.toFixed(2)}x
Downside Year 1 DSCR: ${params.dscrDownside.toFixed(2)}x
Projected Year 1 revenue: $${Math.round(params.projectedRevenueYear1).toLocaleString()}
Annual break-even revenue: $${Math.round(params.breakEvenRevenue).toLocaleString()}
Monthly debt service: $${Math.round(params.monthlyDebtService).toLocaleString()}

Fixed costs (deferrable/reducible):
${fixedCostsList || "(none listed)"}

Planned hires (deferrable):
${hiresList || "(none listed)"}

Sensitivity scenarios:
${scenariosList || "(none provided)"}

Return ONLY valid JSON with this exact shape:
{
  "risks": [
    {
      "risk": "string (the risk statement)",
      "trigger": "string (specific observable threshold with a number)",
      "impact": "string (specific dollar or ratio consequence)",
      "actions": ["string (specific, dollar-denominated)", "..."],
      "severity": "low|medium|high"
    }
  ]
}`;

  try {
    const text = await callGeminiJSON(prompt);
    const parsed = tryParseJson<{ risks?: unknown[] }>(text);
    if (!parsed || !Array.isArray(parsed.risks)) return null;
    const cleaned = parsed.risks
      .map(sanitizeRisk)
      .filter((r): r is RiskContingency => r !== null);
    if (cleaned.length === 0) return null;
    return cleaned.slice(0, 5);
  } catch (err) {
    console.error(
      "[sbaBusinessPlanRoadmap] generateRiskContingencyMatrix error:",
      err,
    );
    return null;
  }
}
