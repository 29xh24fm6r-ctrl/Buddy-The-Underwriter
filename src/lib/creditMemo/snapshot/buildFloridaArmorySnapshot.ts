// Florida Armory snapshot orchestrator.
//
// Pure assembly from canonical memo + readiness contract + overrides.
// Throws when readiness blockers exist (defense-in-depth on the gate).
// Section warnings are non-fatal and surface in diagnostics.

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
import { assertCommitteeMemoSafe } from "./assertCommitteeMemoSafe";

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

function sourceCoverage(sources: FloridaArmorySource[], canonicalMemo: CanonicalCreditMemoV1) {
  // Count from both the source array AND the canonical memo's actual content
  const fromSources = {
    document_sources: sources.filter((s) => s.source_type === "document").length,
    financial_fact_sources: sources.filter((s) => s.source_type === "financial_fact").length,
    research_sources: sources.filter((s) => s.source_type === "research").length,
    override_sources: sources.filter((s) => s.source_type === "override").length,
  };

  // Derive content-based counts from canonical memo to ensure non-zero when data exists
  let factCount = fromSources.financial_fact_sources;
  if (factCount === 0) {
    // Count non-null metric values as fact sources
    const fa = canonicalMemo.financial_analysis;
    const metricsPresent = [fa.dscr, fa.revenue, fa.ebitda, fa.net_income, fa.cash_flow_available, fa.debt_service, fa.dscr_stressed].filter((m) => m.value !== null).length;
    const tableRows = (fa.debt_coverage_table?.length ?? 0) + (fa.income_statement_table?.length ?? 0) + (fa.balance_sheet_table?.length ?? 0);
    factCount = metricsPresent + tableRows;
  }

  let docCount = fromSources.document_sources;
  if (docCount === 0) {
    // Count spreads as document sources
    docCount = canonicalMemo.meta?.spreads?.length ?? 0;
  }

  let researchCount = fromSources.research_sources;
  if (researchCount === 0 && canonicalMemo.business_industry_analysis) {
    const rc = canonicalMemo.business_industry_analysis.research_coverage;
    researchCount = rc.missions_count + (rc.facts_count > 0 ? 1 : 0);
  }

  let overrideCount = fromSources.override_sources;
  if (overrideCount === 0 && canonicalMemo.banker_context?.banker_notes) {
    overrideCount = 1;
  }

  return {
    document_sources: docCount,
    financial_fact_sources: factCount,
    research_sources: researchCount,
    override_sources: overrideCount,
  };
}

function collectWarnings(
  snapshotSections: ReturnType<typeof buildAllFloridaArmorySections>,
) {
  return Object.values(snapshotSections).flatMap((s) =>
    s.warnings.map((w) => `${s.title}: ${w}`),
  );
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

  const snapshot: FloridaArmoryMemoSnapshot = {
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
      source_coverage: sourceCoverage(sources, canonicalMemo),
      warnings,
    },
    canonical_memo: canonicalMemo,
  };

  // Certification-time must enforce the SAME committee-safety guard that PDF
  // export enforces later — otherwise a memo can be banker-certified and
  // frozen (immutable once submitted, per the DB trigger) while still
  // containing forbidden placeholders/contradictions, discovered only when
  // the PDF route 409s, with no remediation path except a full resubmission.
  assertCommitteeMemoSafe(snapshot);

  return snapshot;
}
