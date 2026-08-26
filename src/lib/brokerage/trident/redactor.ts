import "server-only";

/**
 * Trident preview redactor — DATA LAYER.
 *
 * S3-1 (revisions-round-4.md): redaction happens by modifying the data
 * passed to the renderer. The watermark applied by the renderer is a
 * cosmetic overlay — if the watermark is removed, the document still
 * contains zero precise borrower numbers and no full narratives.
 *
 * Pure function. No DB, no I/O, no LLM. Every change here bumps
 * REDACTOR_VERSION; the bundle row records the version used.
 */

export const REDACTOR_VERSION = "1.1.0";

const PREVIEW_PLACEHOLDER = "[Unlocks when you pick a lender]";

// Input shape mirrors the fields that reach the SBA package renderer.
// Keep this decoupled from RenderInput — the orchestrator adapts.
export type SBAPackageInputs = {
  dealName: string;
  loanType: string;
  loanAmount: number;
  baseYear: {
    revenue: number;
    cogs: number;
    operatingExpenses: number;
    ebitda: number;
    depreciation: number;
    netIncome: number;
    totalDebtService: number;
  };
  annualProjections: Array<{
    year: number;
    revenue: number;
    dscr: number;
    totalDebtService: number;
    ebitda: number;
    [key: string]: unknown;
  }>;
  executiveSummary: string;
  industryAnalysis: string;
  marketingStrategy: string;
  operationsPlan: string;
  swotStrengths: string;
  swotWeaknesses: string;
  swotOpportunities: string;
  swotThreats: string;
  businessOverviewNarrative: string;
  sensitivityNarrative: string;
  useOfProceeds: Array<{
    category: string;
    amount: number;
    description?: string;
    [key: string]: unknown;
  }>;
  sourcesAndUses: unknown;
  planThesis: string | null;
};

export type FeasibilityInputs = {
  compositeScore: number;
  marketDemandScore: number;
  financialViabilityScore: number;
  operationalReadinessScore: number;
  locationSuitabilityScore: number;
  narratives: Record<string, string>;
};

/**
 * Free-text fields inside the feasibility dimension trees. Both are rendered
 * verbatim into the PDF (feasibilityRenderer's renderDimensionDetail and
 * renderFlagList), and both interpolate exact borrower figures — e.g.
 * "Projected revenue exceeds break-even by $487,250", "Year 1 DSCR: 1.42x",
 * "Working capital reserve: 4.3 months". Scores, weights, dataSource and
 * dataAvailable carry no precise borrower values and stay intact: per the
 * S3-1 contract the scores ARE the preview signal.
 */
const FEASIBILITY_FREE_TEXT_KEYS = new Set(["detail", "message"]);

/** Redact an SBA package inputs bundle to preview mode. */
export function redactSBAPackageForPreview(
  inputs: SBAPackageInputs,
): SBAPackageInputs {
  return {
    ...inputs,
    // Loan amount rounded to nearest $25K so the precise ask never leaks.
    loanAmount: roundToBucket(inputs.loanAmount, 25_000),

    // Base-year figures bucketed. A borrower's $487,250 revenue becomes
    // $475,000 — close enough to communicate scale, not the actual number.
    baseYear: {
      revenue: roundToBucket(inputs.baseYear.revenue, 25_000),
      cogs: roundToBucket(inputs.baseYear.cogs, 25_000),
      operatingExpenses: roundToBucket(inputs.baseYear.operatingExpenses, 25_000),
      ebitda: roundToBucket(inputs.baseYear.ebitda, 10_000),
      depreciation: roundToBucket(inputs.baseYear.depreciation, 10_000),
      netIncome: roundToBucket(inputs.baseYear.netIncome, 10_000),
      totalDebtService: roundToBucket(inputs.baseYear.totalDebtService, 10_000),
    },

    // Annual projections: same bucketing. DSCR is the strength signal we
    // want preserved — rounded to one decimal.
    annualProjections: inputs.annualProjections.map((p) => ({
      ...p,
      revenue: roundToBucket(p.revenue, 25_000),
      ebitda: roundToBucket(p.ebitda, 10_000),
      totalDebtService: roundToBucket(p.totalDebtService, 10_000),
      dscr: Math.round(p.dscr * 10) / 10,
    })),

    // Full narratives → teaser + unlock placeholder.
    executiveSummary: previewNarrative(
      inputs.executiveSummary,
      "A preview-grade executive summary is available.",
    ),
    industryAnalysis: previewNarrative(
      inputs.industryAnalysis,
      "Industry analysis is complete.",
    ),
    marketingStrategy: previewNarrative(
      inputs.marketingStrategy,
      "Marketing strategy is complete.",
    ),
    operationsPlan: previewNarrative(
      inputs.operationsPlan,
      "Operations plan is complete.",
    ),
    swotStrengths: previewNarrative(
      inputs.swotStrengths,
      "SWOT strengths identified.",
    ),
    swotWeaknesses: previewNarrative(
      inputs.swotWeaknesses,
      "SWOT weaknesses identified.",
    ),
    swotOpportunities: previewNarrative(
      inputs.swotOpportunities,
      "SWOT opportunities identified.",
    ),
    swotThreats: previewNarrative(
      inputs.swotThreats,
      "SWOT threats identified.",
    ),
    businessOverviewNarrative: previewNarrative(
      inputs.businessOverviewNarrative,
      "Business overview complete.",
    ),
    sensitivityNarrative: previewNarrative(
      inputs.sensitivityNarrative,
      "Sensitivity analysis complete.",
    ),

    // Use-of-proceeds line items: keep categories (strength signal), zero
    // amounts, opaque descriptions.
    useOfProceeds: inputs.useOfProceeds.map((item) => ({
      ...item,
      amount: 0,
      description: PREVIEW_PLACEHOLDER,
    })),

    // sources_and_uses is opaqued entirely.
    sourcesAndUses: { preview: true, message: PREVIEW_PLACEHOLDER },

    // High-level plan thesis is allowed — it's strategic framing, not
    // operating history.
    planThesis: inputs.planThesis,
  };
}

/**
 * Deep-redact the feasibility dimension detail trees for preview.
 *
 * Structure-preserving: every score, weight, flag severity, dimension label,
 * and data-source string survives, so the rendered preview keeps its shape
 * and its signal. Only the free-text fields that embed precise borrower
 * figures are replaced. Applied at the DATA layer, before the renderer sees
 * the object — stripping the watermark cannot recover the numbers.
 */
export function redactFeasibilityDetailForPreview<T>(value: T): T {
  return redactDetailNode(value) as T;
}

function redactDetailNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDetailNode);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        FEASIBILITY_FREE_TEXT_KEYS.has(key) && typeof child === "string"
          ? PREVIEW_PLACEHOLDER
          : redactDetailNode(child),
      ]),
    );
  }
  return value;
}

/** Redact feasibility inputs for preview. */
export function redactFeasibilityForPreview(
  inputs: FeasibilityInputs,
): FeasibilityInputs {
  // Scores (0–100 integers) ARE the preview signal — not redacted.
  return {
    ...inputs,
    narratives: Object.fromEntries(
      Object.entries(inputs.narratives).map(([key, _value]) => [
        key,
        `${humanizeDimensionKey(key)} analysis complete. Full narrative unlocks when you pick a lender.`,
      ]),
    ),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Round to nearest bucket size. Returns 0 for non-finite inputs and exact 0. */
function roundToBucket(value: number, bucket: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Math.round(value / bucket) * bucket;
}

/** Teaser + unlock placeholder. Empty inputs get a fallback message only. */
function previewNarrative(full: string, fallback: string): string {
  if (!full || full.trim().length === 0) return fallback;
  const teaser = full.trim().slice(0, 180);
  const truncated = teaser.length < full.trim().length ? `${teaser}…` : teaser;
  return `${truncated}\n\n${PREVIEW_PLACEHOLDER}`;
}

function humanizeDimensionKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}
