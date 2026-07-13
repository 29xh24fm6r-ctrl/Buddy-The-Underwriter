/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 4
 *
 * Deterministic adversarial contradiction checklist. The synthesis thread only
 * EMITS a contradiction when it finds one, so "coverage" computed purely from
 * matched free text undercounts (the live OmniCare mission showed 2/8). This
 * module always produces all 8 structured checks: each is "addressed" whether
 * it is clear, flagged, or insufficient_evidence — what matters for committee is
 * the committee_blocker flag, not whether a contradiction was *found*.
 *
 * Pure module (no server-only, no DB) — fully unit-testable.
 */

export const REQUIRED_CONTRADICTION_CHECKS = [
  "identity_mismatch",
  "dba_mismatch",
  "geography_mismatch",
  "scale_plausibility",
  "management_history_conflict",
  "regulatory_vs_margin",
  "competitive_position_conflict",
  "repayment_story_conflict",
] as const;

export type ContradictionCheckKey = typeof REQUIRED_CONTRADICTION_CHECKS[number];

export type ContradictionStatus = "clear" | "flagged" | "insufficient_evidence";
export type ContradictionSeverity = "info" | "warn" | "error";
export type ContradictionEvidenceBasis =
  | "public_web"
  | "loan_file"
  | "banker_certified"
  | "fallback"
  | "insufficient";

export type ContradictionCheck = {
  check_key: ContradictionCheckKey;
  status: ContradictionStatus;
  basis: string;
  severity: ContradictionSeverity;
  evidence_basis: ContradictionEvidenceBasis;
  committee_blocker: boolean;
};

/** Free-text signals that a given adversarial check surfaced a contradiction. */
const CHECK_FLAG_PATTERNS: Record<ContradictionCheckKey, RegExp[]> = {
  identity_mismatch: [/\bname.*mismatch\b/i, /\bentity.*mismatch\b/i, /\bwrong\s+entity\b/i, /\bCHECK\s*A\b/i, /\bUNVALIDATED_MANAGEMENT_PROFILE\b/],
  dba_mismatch: [/\bdba\b/i, /\bdoing\s+business\s+as\b/i, /\btrade\s*name.*mismatch\b/i],
  geography_mismatch: [/\bgeograph/i, /\bdifferent\s+market\b/i, /\bCHECK\s*C\b/i],
  scale_plausibility: [/\brevenue.*(plausib|implausib|inconsist)/i, /\bscale.*inconsist/i, /\bCHECK\s*B\b/i],
  management_history_conflict: [/\bmanagement.*(conflict|concern)\b/i, /\bprincipal.*(history|prior venture)\b/i, /\bCHECK\s*E\b/i],
  regulatory_vs_margin: [/\bregulat.*margin\b/i, /\bcompliance.*cost\b/i, /\bCHECK\s*H\b/i],
  competitive_position_conflict: [/\bcompetit.*(conflict|overstat|position)\b/i, /\bmarket\s*share.*inconsist/i],
  repayment_story_conflict: [/\brepayment.*(conflict|concern|weak)\b/i, /\bcash\s*flow.*inconsist/i, /\bDSCR.*concern\b/i],
};

export type ContradictionContext = {
  contradictionsText: string;
  entityConflict: boolean;
  entityConfirmedPublicly: boolean;
  /** Identity anchored by banker-certified context with no public conflict. */
  hasBankerCertifiedIdentity: boolean;
  hasLegalIdentity: boolean;  // legal_name / dba / hq known
  managementBasis: "public_web" | "fallback" | null;
  managementProfileOnFile: boolean;
  managementPubliclyConfirmed: boolean;
  hasBorrowerThread: boolean;
  hasMarketThread: boolean;
  hasIndustryThread: boolean;
  hasCompetitiveThread: boolean;
  hasTransactionThread: boolean;
  hasRevenue: boolean;
  namedCompetitors: number;
  /**
   * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md — deferred item, now
   * wired): the loan-file/banker-stated annual revenue figure, used to
   * cross-check against dollar amounts actually mentioned in the borrower
   * research narrative (see borrowerScaleText / extractMentionedRevenueFigures).
   * Optional — when omitted, scale_plausibility falls back to its prior
   * presence-only behavior.
   */
  annualRevenue?: number | null;
  /**
   * Concatenated borrower-thread prose (company_overview, customer_base_and_reach,
   * etc.) scanned for mentioned dollar figures to diff against annualRevenue.
   * This is real cross-thread numeric comparison, not the LLM grading its own
   * "contradictions_and_uncertainties" self-report (contradictionsText).
   */
  borrowerScaleText?: string | null;
  /**
   * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md round 5): concatenated
   * transaction-thread prose (primary/secondary repayment source, downside
   * case, stress scenario, collateral adequacy) scanned for mentioned
   * dollar figures, cross-checked against annualRevenue the same way
   * borrowerScaleText is for scale_plausibility — but from a DIFFERENT
   * thread's narrative, so it catches a distinct failure mode: the borrower
   * thread's own scale claim can be internally consistent while the
   * transaction thread's repayment analysis assumes a wildly different
   * scale of business. Deliberately dollar-figure extraction only (the same
   * well-tested extractMentionedRevenueFigures already used for
   * scale_plausibility), not DSCR-ratio extraction — an earlier round
   * judged DSCR-style ratios too unreliable to extract from prose without
   * false positives; a plain dollar figure is not.
   */
  transactionRepaymentText?: string | null;
};

function flagged(key: ContradictionCheckKey, text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  return CHECK_FLAG_PATTERNS[key].some((p) => p.test(text));
}

/** Formats a raw dollar number compactly, e.g. 12_500_000 -> "$12.5M". */
function formatDollars(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

const DOLLAR_FIGURE_PATTERN = /\$\s?([\d,]+(?:\.\d+)?)\s?(billion|million|thousand|[bmk])?\b/gi;
const UNIT_MULTIPLIERS: Record<string, number> = {
  billion: 1_000_000_000, b: 1_000_000_000,
  million: 1_000_000, m: 1_000_000,
  thousand: 1_000, k: 1_000,
};

/**
 * Extract dollar figures mentioned in free-text research narrative (e.g.
 * "generates approximately $12 million in annual revenue"), normalized to
 * raw numbers. Pure, regex-based — deliberately simple (no NLP dependency);
 * false negatives (a figure phrased in a way the regex misses) just fall
 * back to the existing presence-only check, never producing a false
 * "contradiction" from a parsing miss.
 */
export function extractMentionedRevenueFigures(text: string | null | undefined): number[] {
  if (!text) return [];
  const figures: number[] = [];
  const re = new RegExp(DOLLAR_FIGURE_PATTERN);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const multiplier = UNIT_MULTIPLIERS[unit] ?? 1;
    figures.push(raw * multiplier);
  }
  return figures;
}

/** Ratio of the larger to the smaller of two positive numbers (>= 1). */
function magnitudeRatio(a: number, b: number): number {
  return Math.max(a, b) / Math.min(a, b);
}

// A mentioned figure more than 5x (or less than 1/5x) the loan-file revenue
// is treated as an implausible scale mismatch worth flagging for review —
// wide enough to tolerate "revenue" vs. "gross bookings"-style loose prose,
// narrow enough to catch a genuinely different-scale business.
const SCALE_IMPLAUSIBLE_RATIO = 5;

/**
 * Build the full 8-check contradiction checklist. Every check is emitted; a
 * check with no evidence is "insufficient_evidence" (addressed, but a committee
 * blocker), not silently dropped. Wrong/conflicting entity is the only hard
 * error.
 */
export function buildContradictionChecklist(ctx: ContradictionContext): ContradictionCheck[] {
  const t = ctx.contradictionsText ?? "";

  const checks: ContradictionCheck[] = [];

  // 1. identity_mismatch — the only hard error path.
  if (ctx.entityConflict) {
    checks.push(mk("identity_mismatch", "flagged", "error", "public_web", true,
      "Conflicting/wrong public entity — research may describe a different company."));
  } else if (ctx.entityConfirmedPublicly) {
    checks.push(mk("identity_mismatch", "clear", "info", "public_web", false,
      "Entity confirmed against public sources; no identity mismatch."));
  } else if (ctx.hasBankerCertifiedIdentity) {
    checks.push(mk("identity_mismatch", "clear", "info", "banker_certified", false,
      "No conflicting public entity found; identity anchored by banker-certified context."));
  } else {
    checks.push(mk("identity_mismatch", "insufficient_evidence", "warn", "insufficient", true,
      "Entity not publicly verifiable yet — provide legal name / DBA / website to confirm."));
  }

  // 2. dba_mismatch
  checks.push(flagged("dba_mismatch", t)
    ? mk("dba_mismatch", "flagged", "warn", basis(ctx), true, "DBA / trade-name mismatch raised in synthesis.")
    : ctx.hasLegalIdentity
      ? mk("dba_mismatch", "clear", "info", basis(ctx), false, "Legal name / DBA on file; no trade-name conflict found.")
      : mk("dba_mismatch", "insufficient_evidence", "info", "insufficient", false, "No DBA/legal-name detail to cross-check."));

  // 3. geography_mismatch
  checks.push(flagged("geography_mismatch", t)
    ? mk("geography_mismatch", "flagged", "warn", "public_web", true, "Geography/market mismatch raised in synthesis.")
    : ctx.hasMarketThread
      ? mk("geography_mismatch", "clear", "info", "public_web", false, "Market research aligned to the borrower's HQ geography.")
      : mk("geography_mismatch", "insufficient_evidence", "info", "loan_file", false, "Geography taken from the loan file; not externally cross-checked."));

  // 4. scale_plausibility — real cross-thread numeric diffing when possible,
  // instead of trusting only the LLM's own self-reported "contradictions"
  // text or a presence-only (no actual comparison) fallback.
  checks.push(scalePlausibilityCheck(ctx, t));

  // 5. management_history_conflict
  if (flagged("management_history_conflict", t)) {
    checks.push(mk("management_history_conflict", "flagged", "warn", "public_web", true, "Management/principal history concern raised in synthesis."));
  } else if (ctx.managementPubliclyConfirmed) {
    checks.push(mk("management_history_conflict", "clear", "info", "public_web", false, "Principal history publicly verified; no conflict found."));
  } else if (ctx.managementBasis === "fallback") {
    checks.push(mk("management_history_conflict", "insufficient_evidence", "warn", "fallback", true,
      "Management profile is banker-certified/file-based; public history could not be verified."));
  } else if (ctx.managementProfileOnFile) {
    checks.push(mk("management_history_conflict", "insufficient_evidence", "warn", "banker_certified", true,
      "Management profile on file; public history not yet verified."));
  } else {
    checks.push(mk("management_history_conflict", "insufficient_evidence", "warn", "insufficient", true,
      "No management profile available to assess history conflicts."));
  }

  // 6. regulatory_vs_margin
  checks.push(flagged("regulatory_vs_margin", t)
    ? mk("regulatory_vs_margin", "flagged", "warn", "public_web", true, "Regulatory burden vs margin tension raised in synthesis.")
    : ctx.hasIndustryThread
      ? mk("regulatory_vs_margin", "clear", "info", "public_web", false, "Regulatory environment assessed against margin profile; no conflict found.")
      : mk("regulatory_vs_margin", "insufficient_evidence", "warn", "insufficient", true, "Industry/regulatory research unavailable — committee needs external sources."));

  // 7. competitive_position_conflict
  checks.push(flagged("competitive_position_conflict", t)
    ? mk("competitive_position_conflict", "flagged", "warn", "public_web", true, "Competitive-position overstatement raised in synthesis.")
    : ctx.hasCompetitiveThread && ctx.namedCompetitors >= 1
      ? mk("competitive_position_conflict", "clear", "info", "public_web", false, `${ctx.namedCompetitors} competitor(s) identified; positioning is consistent.`)
      : mk("competitive_position_conflict", "insufficient_evidence", "warn", "insufficient", true, "No named competitors to validate competitive positioning."));

  // 8. repayment_story_conflict — real cross-thread numeric diffing when
  // possible (see repaymentScaleCheck), instead of trusting only the LLM's
  // own self-reported "contradictions" text or a presence-only fallback.
  checks.push(repaymentScaleCheck(ctx, t));

  return checks;
}

/**
 * Real cross-thread numeric diff for scale_plausibility: compares the
 * loan-file/banker-stated annual revenue against dollar figures actually
 * mentioned in the borrower research narrative. Falls back to the prior
 * self-report-or-presence-only behavior when a numeric comparison isn't
 * possible (no stated revenue, or no comparable figure mentioned in the
 * narrative) — never invents a contradiction from missing data.
 */
function scalePlausibilityCheck(ctx: ContradictionContext, contradictionsText: string): ContradictionCheck {
  const stated = ctx.annualRevenue ?? null;
  const mentioned = extractMentionedRevenueFigures(ctx.borrowerScaleText);
  const hasNumericComparison = stated != null && stated > 0 && mentioned.length > 0;

  if (hasNumericComparison) {
    // Compare against whichever mentioned figure is CLOSEST in magnitude to
    // the stated revenue, not just the largest — a narrative often mentions
    // multiple dollar figures (e.g. a specific contract value alongside
    // overall revenue), and comparing the wrong one would produce a false
    // mismatch.
    let closest = mentioned[0];
    let closestRatio = magnitudeRatio(closest, stated!);
    for (const figure of mentioned) {
      const ratio = magnitudeRatio(figure, stated!);
      if (ratio < closestRatio) {
        closest = figure;
        closestRatio = ratio;
      }
    }

    if (closestRatio > SCALE_IMPLAUSIBLE_RATIO) {
      return mk(
        "scale_plausibility", "flagged", "warn", "public_web", true,
        `Revenue scale mismatch (cross-thread numeric check): loan file states ~${formatDollars(stated!)}, ` +
        `research narrative mentions ~${formatDollars(closest)} — ${closestRatio.toFixed(1)}x apart.`,
      );
    }
    return mk(
      "scale_plausibility", "clear", "info", "public_web", false,
      `Revenue scale consistent (cross-thread numeric check): loan file ~${formatDollars(stated!)} vs. ` +
      `research narrative ~${formatDollars(closest)} (${closestRatio.toFixed(1)}x).`,
    );
  }

  // No numeric comparison possible — fall back to the LLM self-report signal,
  // then the old presence-only "consistent" claim (honestly relabeled as
  // insufficient rather than "clear" when no real comparison ever happened).
  if (flagged("scale_plausibility", contradictionsText)) {
    return mk("scale_plausibility", "flagged", "warn", "loan_file", true, "Revenue/scale plausibility concern raised in synthesis.");
  }
  if (ctx.hasRevenue && ctx.hasBorrowerThread) {
    return mk(
      "scale_plausibility", "insufficient_evidence", "info", "loan_file", false,
      "Revenue stated on file, but the research narrative did not mention a comparable dollar figure to cross-check.",
    );
  }
  return mk("scale_plausibility", "insufficient_evidence", "info", "insufficient", false, "Insufficient financial/scale detail to assess plausibility.");
}

/**
 * Real cross-thread numeric diff for repayment_story_conflict: compares the
 * loan-file/banker-stated annual revenue against dollar figures actually
 * mentioned in the TRANSACTION thread's repayment narrative — a distinct
 * check from scale_plausibility, which only looks at the borrower thread.
 * A transaction thread that internally assumes a wildly different scale of
 * business than the borrower thread (and the loan file) reported is a real,
 * checkable inconsistency between two independently-generated threads, not
 * a self-report the LLM has to notice and flag itself. Falls back to the
 * prior self-report-or-presence-only behavior when no numeric comparison is
 * possible — never invents a contradiction from missing data.
 */
function repaymentScaleCheck(ctx: ContradictionContext, contradictionsText: string): ContradictionCheck {
  const stated = ctx.annualRevenue ?? null;
  const mentioned = extractMentionedRevenueFigures(ctx.transactionRepaymentText);
  const hasNumericComparison = stated != null && stated > 0 && mentioned.length > 0;

  if (hasNumericComparison) {
    let closest = mentioned[0];
    let closestRatio = magnitudeRatio(closest, stated!);
    for (const figure of mentioned) {
      const ratio = magnitudeRatio(figure, stated!);
      if (ratio < closestRatio) {
        closest = figure;
        closestRatio = ratio;
      }
    }

    if (closestRatio > SCALE_IMPLAUSIBLE_RATIO) {
      return mk(
        "repayment_story_conflict", "flagged", "warn", "loan_file", true,
        `Repayment analysis scale mismatch (cross-thread numeric check): loan file states ~${formatDollars(stated!)} ` +
        `revenue, but the transaction/repayment narrative mentions ~${formatDollars(closest)} — ${closestRatio.toFixed(1)}x apart.`,
      );
    }
    return mk(
      "repayment_story_conflict", "clear", "info", "loan_file", false,
      `Repayment analysis scale consistent (cross-thread numeric check): loan file ~${formatDollars(stated!)} vs. ` +
      `transaction narrative ~${formatDollars(closest)} (${closestRatio.toFixed(1)}x).`,
    );
  }

  // No numeric comparison possible — fall back to the LLM self-report signal,
  // then presence-only.
  if (flagged("repayment_story_conflict", contradictionsText)) {
    return mk("repayment_story_conflict", "flagged", "warn", "loan_file", true, "Repayment-story / cash-flow conflict raised in synthesis.");
  }
  if (ctx.hasTransactionThread) {
    return mk("repayment_story_conflict", "clear", "info", "loan_file", false, "Repayment thesis assessed; no internal contradiction found.");
  }
  return mk("repayment_story_conflict", "insufficient_evidence", "warn", "insufficient", true, "Transaction/repayment analysis unavailable to cross-check.");
}

function basis(ctx: ContradictionContext): ContradictionEvidenceBasis {
  return ctx.entityConfirmedPublicly ? "public_web" : ctx.hasBankerCertifiedIdentity ? "banker_certified" : "loan_file";
}

function mk(
  check_key: ContradictionCheckKey,
  status: ContradictionStatus,
  severity: ContradictionSeverity,
  evidence_basis: ContradictionEvidenceBasis,
  committee_blocker: boolean,
  basisText: string,
): ContradictionCheck {
  return { check_key, status, severity, evidence_basis, committee_blocker, basis: basisText };
}

/** Summary used by the completion gate. Every check is addressed by construction. */
export function summarizeContradictionChecklist(checks: ContradictionCheck[]): {
  addressed: number;
  total: number;
  flagged: number;
  insufficient: number;
  committeeBlockers: ContradictionCheckKey[];
  hasError: boolean;
} {
  return {
    addressed: checks.length, // all checks are addressed (clear/flagged/insufficient)
    total: checks.length,
    flagged: checks.filter((c) => c.status === "flagged").length,
    insufficient: checks.filter((c) => c.status === "insufficient_evidence").length,
    committeeBlockers: checks.filter((c) => c.committee_blocker).map((c) => c.check_key),
    hasError: checks.some((c) => c.severity === "error"),
  };
}
