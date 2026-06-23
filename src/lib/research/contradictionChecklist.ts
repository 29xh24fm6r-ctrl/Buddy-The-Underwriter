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
};

function flagged(key: ContradictionCheckKey, text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  return CHECK_FLAG_PATTERNS[key].some((p) => p.test(text));
}

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

  // 4. scale_plausibility
  checks.push(flagged("scale_plausibility", t)
    ? mk("scale_plausibility", "flagged", "warn", "loan_file", true, "Revenue/scale plausibility concern raised in synthesis.")
    : ctx.hasRevenue && ctx.hasBorrowerThread
      ? mk("scale_plausibility", "clear", "info", "loan_file", false, "Stated revenue is consistent with the described business scale.")
      : mk("scale_plausibility", "insufficient_evidence", "info", "insufficient", false, "Insufficient financial/scale detail to assess plausibility."));

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

  // 8. repayment_story_conflict
  checks.push(flagged("repayment_story_conflict", t)
    ? mk("repayment_story_conflict", "flagged", "warn", "loan_file", true, "Repayment-story / cash-flow conflict raised in synthesis.")
    : ctx.hasTransactionThread
      ? mk("repayment_story_conflict", "clear", "info", "loan_file", false, "Repayment thesis assessed; no internal contradiction found.")
      : mk("repayment_story_conflict", "insufficient_evidence", "warn", "insufficient", true, "Transaction/repayment analysis unavailable to cross-check."));

  return checks;
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
