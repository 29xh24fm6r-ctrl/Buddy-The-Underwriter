/**
 * Deal → bank matching.
 *
 * The brokerage's most-asked question — "which of my banks would buy this
 * deal?" — had no answer in the product: appetite was recorded as prose and
 * never read. This module is the answer, and it is deliberately a pure,
 * deterministic function over plain data:
 *
 *   - no database access (callers pass rows in, same convention as
 *     src/lib/crm/*.ts and src/lib/brokerage/revenueOps.ts),
 *   - no LLM. "Which banks lend in Texas under $3M" is a set operation, not
 *     a judgement call, and a broker has to be able to defend the shortlist
 *     to the borrower. Every result carries the reasons and disqualifiers
 *     that produced it.
 *
 * Hard rules make a bank ineligible outright: geography, loan program, an
 * excluded industry, and a loan size outside the stated band. Those are the
 * facts a banker states once and does not bend on. Soft rules (DSCR, LTV,
 * FICO) only move the score and are surfaced as warnings, because at intake
 * those numbers are provisional — refusing to show a bank because a
 * not-yet-spread DSCR looks thin would hide the very bank the broker should
 * call.
 */

import { normalizeStateCode } from "@/lib/crm/geography";

export type GeographyMode = "nationwide" | "states";

/** A bank's stated credit box, flattened from crm_lender_profiles. */
export type LenderCreditBox = {
  lenderProfileId: string;
  organizationId: string;
  name: string;
  relationshipStatus: string | null;
  geographyMode: GeographyMode;
  stateCodes: string[];
  excludedStateCodes: string[];
  naicsCodes: string[];
  excludedNaicsCodes: string[];
  minLoanAmount: number | null;
  maxLoanAmount: number | null;
  minDscr: number | null;
  maxLtv: number | null;
  minimumFico: number | null;
  sba7aAppetite: boolean;
  sba504Appetite: boolean;
  conventionalAppetite: boolean;
  responseSlaDays: number | null;
  /** Legacy free-text geographies, kept only to warn that appetite is unstructured. */
  legacyGeographies: string[];
};

/** What we know about the deal being placed. Every field may be unknown. */
export type DealCriteria = {
  stateCode: string | null;
  amount: number | null;
  productType: string | null;
  naicsCode: string | null;
  dscr: number | null;
  ltv: number | null;
  fico: number | null;
};

/** Outcome history for one bank, used to rank banks that all fit on paper. */
export type LenderHistory = {
  sent: number;
  responded: number;
  approved: number;
  closed: number;
  closedVolume: number;
  responseRate: number | null;
  approvalRate: number | null;
  avgDaysToRespond: number | null;
};

export type LenderMatch = {
  lenderProfileId: string;
  organizationId: string;
  name: string;
  eligible: boolean;
  score: number;
  /** Why this bank fits — shown to the broker and stored as the fit rationale. */
  reasons: string[];
  /** Hard failures. Non-empty means eligible === false. */
  disqualifiers: string[];
  /** Soft failures and gaps: worth knowing, not worth excluding over. */
  warnings: string[];
  history: LenderHistory | null;
  alreadySent: boolean;
};

const RELATIONSHIP_WEIGHT: Record<string, number> = {
  preferred: 12,
  active: 8,
  qualified: 4,
  prospect: 0,
  paused: -10,
  inactive: -20,
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
}

/** Flattens a crm_lender_profiles row (+ its organization) into a credit box. */
export function toCreditBox(profile: Record<string, any>): LenderCreditBox {
  const mode = profile.geography_mode === "nationwide" ? "nationwide" : "states";
  return {
    lenderProfileId: String(profile.id),
    organizationId: String(profile.organization_id),
    name: String(profile.organization?.name ?? profile.name ?? "Unnamed bank"),
    relationshipStatus: profile.relationship_status ?? null,
    geographyMode: mode,
    stateCodes: toStringList(profile.state_codes).map((s) => s.toUpperCase()),
    excludedStateCodes: toStringList(profile.excluded_state_codes).map((s) => s.toUpperCase()),
    naicsCodes: toStringList(profile.naics_codes),
    excludedNaicsCodes: toStringList(profile.excluded_naics_codes),
    minLoanAmount: toNumber(profile.min_loan_amount),
    maxLoanAmount: toNumber(profile.max_loan_amount),
    minDscr: toNumber(profile.min_dscr),
    maxLtv: toNumber(profile.max_ltv),
    minimumFico: toNumber(profile.minimum_fico),
    sba7aAppetite: profile.sba_7a_appetite !== false,
    sba504Appetite: !!profile.sba_504_appetite,
    conventionalAppetite: !!profile.conventional_appetite,
    responseSlaDays: toNumber(profile.response_sla_days),
    legacyGeographies: toStringList(profile.geographies),
  };
}

/** Reads a deals row into the criteria the matcher needs. */
export function toDealCriteria(deal: Record<string, any>): DealCriteria {
  return {
    stateCode: normalizeStateCode(deal.state ?? deal.state_code ?? null),
    amount: toNumber(deal.loan_amount ?? deal.amount),
    productType: typeof deal.product_type === "string" ? deal.product_type : null,
    naicsCode: typeof deal.naics_code === "string" ? deal.naics_code : null,
    dscr: toNumber(deal.dscr),
    ltv: toNumber(deal.ltv),
    fico: toNumber(deal.fico),
  };
}

/** Which appetite flag a product type needs. Null = no program constraint. */
function appetiteFor(box: LenderCreditBox, productType: string | null): { label: string; ok: boolean } | null {
  if (!productType) return null;
  if (productType === "SBA_7A" || productType === "SBA_EXPRESS") {
    return { label: "SBA 7(a)", ok: box.sba7aAppetite };
  }
  if (productType === "SBA_504") return { label: "SBA 504", ok: box.sba504Appetite };
  return { label: "conventional", ok: box.conventionalAppetite };
}

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** True when `code` sits under any prefix in `prefixes` (NAICS is hierarchical). */
function matchesNaics(prefixes: string[], code: string | null): string | null {
  if (!code) return null;
  for (const prefix of prefixes) {
    if (prefix && code.startsWith(prefix)) return prefix;
  }
  return null;
}

/**
 * Scores one bank against one deal. Exported for tests; callers normally
 * want rankLenders.
 */
export function scoreLender(
  box: LenderCreditBox,
  deal: DealCriteria,
  options: { history?: LenderHistory | null; alreadySent?: boolean } = {},
): LenderMatch {
  const reasons: string[] = [];
  const disqualifiers: string[] = [];
  const warnings: string[] = [];
  let score = 50;

  // ── Geography (hard) ──────────────────────────────────────────────────
  if (deal.stateCode) {
    if (box.excludedStateCodes.includes(deal.stateCode)) {
      disqualifiers.push(`Excludes ${deal.stateCode}`);
    } else if (box.geographyMode === "nationwide") {
      reasons.push(`Lends nationwide`);
      score += 6;
    } else if (box.stateCodes.length === 0) {
      warnings.push("Lending geography not recorded");
    } else if (box.stateCodes.includes(deal.stateCode)) {
      reasons.push(`Lends in ${deal.stateCode}`);
      score += 12;
    } else {
      disqualifiers.push(`Does not lend in ${deal.stateCode}`);
    }
  } else if (box.geographyMode === "states" && box.stateCodes.length > 0) {
    warnings.push("Deal has no state — geography not checked");
  }

  if (box.legacyGeographies.length > 0 && box.stateCodes.length === 0 && box.geographyMode === "states") {
    warnings.push(`Appetite still free-text: "${box.legacyGeographies.join(", ")}"`);
  }

  // ── Loan program (hard) ───────────────────────────────────────────────
  const appetite = appetiteFor(box, deal.productType);
  if (appetite) {
    if (appetite.ok) {
      reasons.push(`Buys ${appetite.label}`);
      score += 6;
    } else {
      disqualifiers.push(`No ${appetite.label} appetite`);
    }
  }

  // ── Loan size (hard) ──────────────────────────────────────────────────
  if (deal.amount !== null) {
    const { minLoanAmount: min, maxLoanAmount: max } = box;
    if (min !== null && deal.amount < min) {
      disqualifiers.push(`Below ${money(min)} minimum`);
    } else if (max !== null && deal.amount > max) {
      disqualifiers.push(`Above ${money(max)} maximum`);
    } else if (min !== null || max !== null) {
      const span = (max ?? deal.amount) - (min ?? 0);
      const edge = span > 0 && (deal.amount - (min ?? 0) < span * 0.1 || (max ?? deal.amount) - deal.amount < span * 0.1);
      reasons.push(edge ? "At the edge of its size band" : "Comfortably inside its size band");
      score += edge ? 5 : 8;
    } else {
      warnings.push("No stated loan size band");
    }
  }

  // ── Industry (excluded is hard, preferred is a bonus) ─────────────────
  const excludedHit = matchesNaics(box.excludedNaicsCodes, deal.naicsCode);
  if (excludedHit) {
    disqualifiers.push(`Excludes NAICS ${excludedHit}`);
  } else if (deal.naicsCode && box.naicsCodes.length > 0) {
    const hit = matchesNaics(box.naicsCodes, deal.naicsCode);
    if (hit) {
      reasons.push(`Preferred industry (NAICS ${hit})`);
      score += 10;
    } else {
      warnings.push("Outside its stated preferred industries");
      score -= 4;
    }
  } else if (box.naicsCodes.length === 0) {
    score += 2;
  }

  // ── Credit metrics (soft) ─────────────────────────────────────────────
  if (deal.dscr !== null && box.minDscr !== null) {
    if (deal.dscr < box.minDscr) {
      warnings.push(`DSCR ${deal.dscr.toFixed(2)} under its ${box.minDscr.toFixed(2)} floor`);
      score -= 8;
    } else {
      reasons.push(`DSCR clears ${box.minDscr.toFixed(2)}`);
      score += 4;
    }
  }
  if (deal.ltv !== null && box.maxLtv !== null && deal.ltv > box.maxLtv) {
    warnings.push(`LTV ${(deal.ltv * 100).toFixed(0)}% over its ${(box.maxLtv * 100).toFixed(0)}% ceiling`);
    score -= 6;
  }
  if (deal.fico !== null && box.minimumFico !== null && deal.fico < box.minimumFico) {
    warnings.push(`FICO ${deal.fico} under its ${box.minimumFico} floor`);
    score -= 6;
  }

  // ── Relationship and responsiveness ───────────────────────────────────
  score += RELATIONSHIP_WEIGHT[box.relationshipStatus ?? "prospect"] ?? 0;
  if (box.relationshipStatus === "preferred") reasons.push("Preferred relationship");

  if (box.responseSlaDays !== null && box.responseSlaDays <= 3) {
    reasons.push(`${box.responseSlaDays}-day response SLA`);
    score += 3;
  }

  const history = options.history ?? null;
  if (history && history.sent > 0) {
    if (history.responseRate !== null) {
      score += Math.round(history.responseRate * 10);
      reasons.push(`Responded to ${history.responded} of ${history.sent}`);
    }
    if (history.approvalRate !== null && history.approved > 0) {
      score += Math.round(history.approvalRate * 8);
      reasons.push(`Approved ${history.approved}`);
    }
  }

  if (options.alreadySent) warnings.push("Already sent this deal");

  const eligible = disqualifiers.length === 0;
  return {
    lenderProfileId: box.lenderProfileId,
    organizationId: box.organizationId,
    name: box.name,
    eligible,
    score: eligible ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    reasons,
    disqualifiers,
    warnings,
    history,
    alreadySent: !!options.alreadySent,
  };
}

/**
 * Ranks every bank against one deal. Eligible banks come first, best score
 * first, then ineligible banks so the broker can still see who was ruled out
 * and why — a silent omission is indistinguishable from missing data.
 */
export function rankLenders(
  boxes: LenderCreditBox[],
  deal: DealCriteria,
  context: {
    historyByProfileId?: Record<string, LenderHistory>;
    alreadySentProfileIds?: Iterable<string>;
  } = {},
): LenderMatch[] {
  const sent = new Set(context.alreadySentProfileIds ?? []);
  const matches = boxes.map((box) =>
    scoreLender(box, deal, {
      history: context.historyByProfileId?.[box.lenderProfileId] ?? null,
      alreadySent: sent.has(box.lenderProfileId),
    }),
  );

  return matches.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.alreadySent !== b.alreadySent) return a.alreadySent ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Rolls a bank's submission rows into the outcome history the ranker uses.
 * `submissions` are crm_deal_lender_submissions rows for one lender profile.
 */
export function summarizeHistory(submissions: Array<Record<string, any>>): LenderHistory {
  const sentRows = submissions.filter((s) => s.status !== "planned");
  const responded = sentRows.filter((s) => !!s.responded_at);
  const approved = sentRows.filter((s) => s.status === "approved" || s.status === "closed");
  const closed = sentRows.filter((s) => s.status === "closed");

  const turnarounds = responded
    .map((s) => {
      const from = s.sent_at ? new Date(s.sent_at).getTime() : null;
      const to = s.responded_at ? new Date(s.responded_at).getTime() : null;
      return from !== null && to !== null && to >= from ? (to - from) / 86_400_000 : null;
    })
    .filter((d): d is number => d !== null);

  return {
    sent: sentRows.length,
    responded: responded.length,
    approved: approved.length,
    closed: closed.length,
    closedVolume: closed.reduce((sum, s) => sum + (toNumber(s.closed_amount) ?? 0), 0),
    responseRate: sentRows.length ? responded.length / sentRows.length : null,
    approvalRate: sentRows.length ? approved.length / sentRows.length : null,
    avgDaysToRespond: turnarounds.length
      ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length
      : null,
  };
}
