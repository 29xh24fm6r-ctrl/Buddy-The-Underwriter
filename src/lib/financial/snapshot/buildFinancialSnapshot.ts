/**
 * Phase 55A — Deterministic Snapshot Builder
 *
 * Composes extracted inputs into one canonical financial snapshot.
 * Detects missing/conflicting facts. Attaches provenance.
 * Pure function — no DB writes (caller persists).
 */

import type { FinancialSnapshot, FinancialSnapshotStatus } from "./types";
import type { FinancialSnapshotFact, FactProvenanceSource } from "./financial-fact-types";
import { deriveSnapshotStatus, aggregateFactStates } from "./deriveSnapshotStatus";

type ExtractedFact = {
  metricKey: string;
  metricLabel: string;
  periodKey: string;
  entityKey?: string | null;
  numericValue?: number | null;
  textValue?: string | null;
  unit?: string | null;
  confidence: number | null;
  documentId: string | null;
  extractedField?: string | null;
  spreadLineRef?: string | null;
};

type BuildInput = {
  dealId: string;
  bankId: string;
  extractedFacts: ExtractedFact[];
  requiredMetricKeys: string[];
  priorSnapshotId?: string | null;
};

type BuildResult = {
  snapshot: Omit<FinancialSnapshot, "id" | "createdAt" | "updatedAt" | "validatedAt" | "supersededBy">;
  facts: Array<Omit<FinancialSnapshotFact, "id" | "snapshotId" | "createdAt" | "updatedAt">>;
  completeness: { total: number; present: number; missing: number; conflicting: number };
  conflicts: Array<{ metricKey: string; periodKey: string; sources: number }>;
  missingKeys: string[];
  recommendedStatus: FinancialSnapshotStatus;
};

/**
 * Build a financial snapshot candidate from extracted facts.
 */
export function buildFinancialSnapshot(input: BuildInput): BuildResult {
  const { dealId, bankId, extractedFacts, requiredMetricKeys } = input;

  // Group facts by metric+period+entity to detect conflicts
  const factMap = new Map<string, ExtractedFact[]>();
  for (const f of extractedFacts) {
    const key = `${f.metricKey}::${f.periodKey}::${f.entityKey ?? "DEAL"}`;
    const group = factMap.get(key) ?? [];
    group.push(f);
    factMap.set(key, group);
  }

  const facts: BuildResult["facts"] = [];
  const conflicts: BuildResult["conflicts"] = [];
  const documentIds = new Set<string>();

  for (const [, group] of factMap) {
    const primary = group[0];
    const isConflict = group.length > 1 && hasValueConflict(group);

    const provenance: FactProvenanceSource[] = group.map((f) => ({
      documentId: f.documentId,
      extractedField: f.extractedField ?? null,
      spreadLineRef: f.spreadLineRef ?? null,
      manualAdjustmentSource: null,
      confidence: f.confidence,
    }));

    for (const f of group) {
      if (f.documentId) documentIds.add(f.documentId);
    }

    const validationState = isConflict
      ? "conflicted" as const
      : (primary.confidence != null && primary.confidence >= 0.9)
        ? "auto_supported" as const
        : "unreviewed" as const;

    if (isConflict) {
      conflicts.push({
        metricKey: primary.metricKey,
        periodKey: primary.periodKey,
        sources: group.length,
      });
    }

    facts.push({
      dealId,
      metricKey: primary.metricKey,
      metricLabel: primary.metricLabel,
      periodKey: primary.periodKey,
      entityKey: primary.entityKey ?? null,
      numericValue: primary.numericValue ?? null,
      textValue: primary.textValue ?? null,
      unit: primary.unit ?? null,
      extractionConfidence: primary.confidence ?? null,
      validationState,
      conflictState: isConflict ? `${group.length}_sources` : null,
      primaryDocumentId: primary.documentId ?? null,
      provenance,
      reviewerUserId: null,
      reviewerRationale: null,
    });
  }

  // Detect missing required metrics
  const presentKeys = new Set(facts.map((f) => f.metricKey));
  const missingKeys = requiredMetricKeys.filter((k) => !presentKeys.has(k));

  // Add missing placeholders
  for (const key of missingKeys) {
    facts.push({
      dealId,
      metricKey: key,
      metricLabel: key.replace(/_/g, " "),
      periodKey: "UNKNOWN",
      entityKey: null,
      numericValue: null,
      textValue: null,
      unit: null,
      extractionConfidence: null,
      validationState: "missing",
      conflictState: null,
      primaryDocumentId: null,
      provenance: [],
      reviewerUserId: null,
      reviewerRationale: null,
    });
  }

  const agg = aggregateFactStates(facts.map((f) => f.validationState));
  const recommendedStatus = deriveSnapshotStatus({
    factCount: agg.total,
    validatedFactCount: agg.validated,
    unresolvedConflictCount: agg.unresolved,
    missingCriticalFactCount: agg.missing,
    hasStaleSources: false,
    isSuperseded: false,
    hasAnyExtractedInput: extractedFacts.length > 0,
  });

  const snapshot = {
    dealId,
    bankId,
    status: recommendedStatus,
    active: true,
    periodStart: derivePeriodBound(extractedFacts, "min"),
    periodEnd: derivePeriodBound(extractedFacts, "max"),
    entityScope: null,
    sourceDocumentCount: documentIds.size,
    materialFactCount: facts.length,
    validatedFactCount: agg.validated,
    unresolvedConflictCount: agg.unresolved,
    missingFactCount: agg.missing,
  };

  return {
    snapshot,
    facts,
    completeness: { total: facts.length, present: facts.length - missingKeys.length, missing: missingKeys.length, conflicting: conflicts.length },
    conflicts,
    missingKeys,
    recommendedStatus,
  };
}

function hasValueConflict(group: ExtractedFact[]): boolean {
  const values = group.map((f) => f.numericValue).filter((v) => v != null);
  if (values.length <= 1) return false;
  return new Set(values).size > 1;
}

function derivePeriodBound(facts: ExtractedFact[], mode: "min" | "max"): string | null {
  const periods = facts.map((f) => f.periodKey).filter(Boolean).sort();
  if (periods.length === 0) return null;
  return mode === "min" ? periods[0] : periods[periods.length - 1];
}
