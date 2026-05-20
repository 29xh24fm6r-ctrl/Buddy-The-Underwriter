// Florida Armory snapshot orchestrator.
//
// Pure assembly from canonical memo + readiness contract + overrides.
// Throws when readiness blockers exist (defense-in-depth on the gate).
// Final committee snapshots must not contain unresolved placeholders,
// section warnings, or cross-engine contradictions.

import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import type { MemoReadinessContract } from "@/lib/creditMemo/submission/evaluateMemoReadinessContract";
import type {
  FloridaArmoryMemoSnapshot,
  FloridaArmorySectionKey,
  FloridaArmorySource,
} from "./types";
import {
  FLORIDA_ARMORY_SECTION_KEYS,
  FloridaArmoryBuildError,
} from "./types";
import { buildAllFloridaArmorySections } from "./sectionBuilders";

type BuildFloridaArmorySnapshotArgs = {
  dealId: string;
  bankId: string;
  bankerId: string;
  memoVersion: number;
  inputHash: string;
  canonicalMemo: CanonicalCreditMemoV1;
  readinessContract: MemoReadinessContract;
  overrides: Record<string, unknown>;
  dataSources?: FloridaArmorySource[];
  submittedAt?: string;
  snapshotId?: string;
};

const SECTION_KEYS = FLORIDA_ARMORY_SECTION_KEYS as readonly FloridaArmorySectionKey[];
const UNRESOLVED_TEXT_PATTERN = /\b(Pending|Unknown|Generating|Unable to compute|Conclusion pending|missing in one or more years)\b/i;
const EMPTY_PLACEHOLDER_PATTERN = /^[-—–]+$/;

function assertNoBlockers(contract: MemoReadinessContract) {
  if (contract.blockers && contract.blockers.length > 0) {
    const labels = contract.blockers.map((b) => b.label ?? b.code).join(", ");
    throw new FloridaArmoryBuildError(
      "readiness_failed",
      contract.blockers.map((b) => b.code),
      `Cannot build Florida Armory snapshot. Readiness blockers: ${labels}`,
    );
  }
}

function defaultSource(sectionKeys: FloridaArmorySectionKey[]): FloridaArmorySource {
  return {
    source_type: "system",
    source_id: null,
    label: "Canonical credit memo builder",
    section_keys: sectionKeys,
    confidence: null,
  };
}

function buildSources(
  canonicalMemo: CanonicalCreditMemoV1,
  supplied: FloridaArmorySource[] | undefined,
): FloridaArmorySource[] {
  const sources: FloridaArmorySource[] =
    supplied && supplied.length > 0
      ? [...supplied]
      : [defaultSource([...SECTION_KEYS])];

  const canonicalSources = ((canonicalMemo as any).sources ?? []) as Array<Record<string, unknown>>;

  for (const source of canonicalSources) {
    sources.push({
      source_type: "document",
      source_id: typeof source.id === "string" ? source.id : null,
      label: String(source.label ?? source.name ?? "Memo source"),
      section_keys: [...SECTION_KEYS],
      confidence: typeof source.confidence === "number" ? source.confidence : null,
      metadata: source,
    });
  }

  return sources;
}

function sourceCoverage(sources: FloridaArmorySource[]) {
  return {
    document_sources: sources.filter((s) => s.source_type === "document").length,
    financial_fact_sources: sources.filter((s) => s.source_type === "financial_fact").length,
    research_sources: sources.filter((s) => s.source_type === "research").length,
    override_sources: sources.filter((s) => s.source_type === "override").length,
  };
}

function collectWarnings(
  snapshotSections: ReturnType<typeof buildAllFloridaArmorySections>,
) {
  return Object.values(snapshotSections).flatMap((s) =>
    s.warnings.map((w) => `${s.title}: ${w}`),
  );
}

function factNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[$,%x,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "value" in value) {
    return factNumber((value as { value?: unknown }).value);
  }
  return null;
}

function isNonEmptyObject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value as Record<string, unknown>).length > 0;
}

function stringContains(value: unknown, pattern: RegExp): boolean {
  if (typeof value === "string") return pattern.test(value);
  if (Array.isArray(value)) return value.some((item) => stringContains(item, pattern));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => stringContains(item, pattern));
  }
  return false;
}

function collectUnresolvedPlaceholders(value: unknown, path = "snapshot", out: string[] = []): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (UNRESOLVED_TEXT_PATTERN.test(trimmed) || EMPTY_PLACEHOLDER_PATTERN.test(trimmed)) {
      out.push(`${path}: ${trimmed}`);
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnresolvedPlaceholders(item, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      collectUnresolvedPlaceholders(item, `${path}.${key}`, out);
    }
  }
  return out;
}

function isArLineOfCreditMemo(memo: CanonicalCreditMemoV1): boolean {
  const haystack = [
    (memo as any).key_metrics?.product,
    (memo as any).proposed_terms?.product,
    (memo as any).transaction_overview?.product,
    (memo as any).transaction_overview?.loan_request?.product,
    (memo as any).transaction_overview?.loan_request?.purpose,
    (memo as any).deal_summary,
    (memo as any).purpose,
    (memo as any).collateral?.narrative,
    (memo as any).collateral?.property_description,
  ].filter(Boolean).join(" ");

  return /\b(LOC|line of credit|revolv|working capital)\b/i.test(haystack)
    && /\b(AR|A\/R|accounts receivable|receivables)\b/i.test(haystack);
}

function assertInstitutionalSnapshotGate(
  memo: CanonicalCreditMemoV1,
  sections: ReturnType<typeof buildAllFloridaArmorySections>,
  warnings: string[],
) {
  const blockers: string[] = [];

  if (warnings.length > 0) {
    blockers.push(...warnings.map((warning) => `section_warning:${warning}`));
  }

  const unresolved = collectUnresolvedPlaceholders({ sections, canonical_memo: memo });
  if (unresolved.length > 0) {
    blockers.push(...unresolved.map((item) => `unresolved_placeholder:${item}`));
  }

  const financial = (memo as any).financial_analysis ?? {};
  const recommendation = (memo as any).recommendation ?? {};
  const dscr = factNumber(financial.dscr ?? financial.dscr_uw ?? (memo as any).key_metrics?.dscr_uw);
  if (dscr !== null && stringContains(recommendation, /Unable to compute|Conclusion pending|DSCR.*missing|missing.*DSCR/i)) {
    blockers.push("engine_contradiction:recommendation_says_dscr_missing_but_dscr_is_computed");
  }

  const netIncome = factNumber(financial.net_income);
  const depreciation = factNumber(financial.depreciation ?? financial.addback_depreciation);
  const interest = factNumber(financial.interest_expense ?? financial.addback_interest);
  const ebitda = factNumber(financial.ebitda ?? financial.cfads ?? financial.cash_flow_available);
  if (
    ebitda !== null
    && ebitda < 0
    && netIncome !== null
    && netIncome >= 0
    && (depreciation === null || depreciation >= 0)
    && (interest === null || interest >= 0)
  ) {
    blockers.push("financial_contradiction:negative_ebitda_with_nonnegative_income_and_addbacks");
  }

  if (isArLineOfCreditMemo(memo)) {
    const collateral = (memo as any).collateral ?? {};
    const borrowingBase = collateral.borrowing_base
      ?? collateral.accounts_receivable_borrowing_base
      ?? collateral.ar_borrowing_base
      ?? (memo as any).borrowing_base
      ?? (memo as any).accounts_receivable_analysis;
    const aging = collateral.ar_aging
      ?? collateral.accounts_receivable_aging
      ?? (memo as any).ar_aging
      ?? (memo as any).accounts_receivable_aging;
    const eligibleAr = factNumber(collateral.eligible_ar ?? collateral.net_eligible_ar ?? (borrowingBase as any)?.eligible_ar);

    if (!isNonEmptyObject(borrowingBase)) blockers.push("ar_loc_missing:borrowing_base_analysis_required");
    if (!isNonEmptyObject(aging)) blockers.push("ar_loc_missing:ar_aging_required");
    if (eligibleAr === null || eligibleAr <= 0) blockers.push("ar_loc_missing:eligible_ar_required");
  }

  if (blockers.length > 0) {
    throw new FloridaArmoryBuildError(
      "institutional_snapshot_gate_failed",
      blockers,
      `Cannot build Florida Armory snapshot. Institutional blockers: ${blockers.join(", ")}`,
    );
  }
}

export function buildFloridaArmorySnapshot({
  dealId,
  bankId,
  bankerId,
  memoVersion,
  inputHash,
  canonicalMemo,
  readinessContract,
  overrides,
  dataSources,
  submittedAt = new Date().toISOString(),
  snapshotId,
}: BuildFloridaArmorySnapshotArgs): FloridaArmoryMemoSnapshot {
  assertNoBlockers(readinessContract);

  const sources = buildSources(canonicalMemo, dataSources);
  const sections = buildAllFloridaArmorySections({ memo: canonicalMemo, sources });
  const warnings = collectWarnings(sections);
  assertInstitutionalSnapshotGate(canonicalMemo, sections, warnings);

  return {
    schema_version: "florida_armory_v1",
    meta: {
      deal_id: dealId,
      bank_id: bankId,
      ...(snapshotId ? { snapshot_id: snapshotId } : {}),
      generated_at: submittedAt,
      generated_by: "buddy",
      submitted_by: bankerId,
      submitted_at: submittedAt,
      submission_role: "banker",
      memo_version: memoVersion,
      input_hash: inputHash,
      render_mode: "committee",
    },
    banker_submission: {
      certification: true,
      submitted_by: bankerId,
      submitted_at: submittedAt,
      reviewed_sections: [...SECTION_KEYS],
      notes: typeof overrides.memoNotes === "string" ? (overrides.memoNotes as string) : null,
      qualitative_overrides: overrides,
      covenant_decisions: Array.isArray(overrides.covenantDecisions)
        ? (overrides.covenantDecisions as unknown[])
        : Array.isArray(overrides.covenant_adjustments)
          ? (overrides.covenant_adjustments as unknown[])
          : [],
      acknowledged_exceptions: Array.isArray(overrides.acknowledgedExceptions)
        ? (overrides.acknowledgedExceptions as unknown[])
        : [],
    },
    sections,
    sources,
    diagnostics: {
      readiness_contract: readinessContract,
      source_coverage: sourceCoverage(sources),
      warnings,
    },
    canonical_memo: canonicalMemo,
  };
}
