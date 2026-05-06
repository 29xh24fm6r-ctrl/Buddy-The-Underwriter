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
