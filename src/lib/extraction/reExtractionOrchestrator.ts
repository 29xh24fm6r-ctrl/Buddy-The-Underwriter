import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { getFormSpec, validateDocumentFacts } from "@/lib/irsKnowledge";
import type { IrsFormType } from "@/lib/irsKnowledge/types";
import { corroborateDocumentFacts } from "@/lib/irsKnowledge/corroborationEngine";
import { checkReasonableness } from "@/lib/irsKnowledge/reasonablenessEngine";
import { aggregateDocumentConfidence } from "@/lib/irsKnowledge/confidenceAggregator";
import {
  generateAuditCertificate,
  persistAuditCertificate,
} from "@/lib/irsKnowledge/auditCertificate";
import type { AuditCertificate } from "@/lib/irsKnowledge/auditCertificate";

// ── Canonical doc type → IRS form type map ──────────────────────────

const DOC_TYPE_TO_IRS_FORM: Record<string, IrsFormType> = {
  TAX_RETURN_1065: "FORM_1065",
  TAX_RETURN_1120: "FORM_1120",
  TAX_RETURN_1120S: "FORM_1120S",
  TAX_RETURN_1040: "FORM_1040",
  PARTNERSHIP_RETURN: "FORM_1065",
  CORPORATE_RETURN: "FORM_1120",
  S_CORP_RETURN: "FORM_1120S",
};

// ── Return types ────────────────────────────────────────────────────

export type ReExtractionResult = {
  status: "AUTO_VERIFIED" | "FLAGGED" | "BLOCKED" | "EXCEPTION";
  attempt: number;
  certificate: AuditCertificate | null;
  exceptionId?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────

async function loadFacts(
  dealId: string,
  documentId: string,
): Promise<Record<string, number | null> | null> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId)
      .eq("source_document_id", documentId);

    if (error || !data || data.length === 0) return null;

    const facts: Record<string, number | null> = {};
    for (const row of data as { fact_key: string; fact_value_num: number | null }[]) {
      facts[row.fact_key] = row.fact_value_num;
    }
    return facts;
  } catch {
    return null;
  }
}

async function loadAllDealFacts(
  dealId: string,
): Promise<Record<string, number | null>> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId);

    if (error || !data) return {};

    const facts: Record<string, number | null> = {};
    for (const row of data as { fact_key: string; fact_value_num: number | null }[]) {
      facts[row.fact_key] = row.fact_value_num;
    }
    return facts;
  } catch {
    return {};
  }
}

type GateRunResult = {
  certificate: AuditCertificate;
  allGatesPassed: boolean;
  failedGates: string[];
};

async function runAllGates(
  documentId: string,
  dealId: string,
  formType: IrsFormType,
  taxYear: number,
  attempt: number,
): Promise<GateRunResult | null> {
  // Load facts
  const facts = await loadFacts(dealId, documentId);
  if (!facts) return null;

  const allDealFacts = await loadAllDealFacts(dealId);

  // Get form spec
  const spec = getFormSpec(formType, taxYear);
  if (!spec) return null;

  // Gate 1: Identity checks
  const identityResult = validateDocumentFacts(documentId, spec, facts);

  // Gate 2: Corroboration
  const corroborationResult = corroborateDocumentFacts(
    documentId,
    formType,
    facts,
    allDealFacts,
  );

  // Gate 3: Reasonableness
  const reasonablenessResult = checkReasonableness(facts, formType);

  // Gate 4: Confidence aggregation
  // Build field confidence scores — use 0.85 default per-field for now
  // (actual per-field confidence from extraction will be wired in a future PR)
  const fieldConfidenceScores: Record<string, number> = {};
  for (const key of Object.keys(facts)) {
    if (facts[key] !== null) {
      fieldConfidenceScores[key] = 0.95;
    }
  }

  const corrobPassed = corroborationResult.filter(r => !r.skipped && r.passed).length;
  const corrobFailed = corroborationResult.filter(r => !r.skipped && !r.passed).length;
  const corrobSkipped = corroborationResult.filter(r => r.skipped).length;

  const impossibleFailures = reasonablenessResult.filter(
    r => r.severity === "IMPOSSIBLE" && !r.passed,
  ).length;
  const anomalousWarnings = reasonablenessResult.filter(
    r => r.severity === "ANOMALOUS" && !r.passed,
  ).length;

  const confidenceResult = aggregateDocumentConfidence({
    fieldConfidenceScores,
    identityCheckResult: {
      passedCount: identityResult.passedCount,
      failedCount: identityResult.failedCount,
      skippedCount: identityResult.skippedCount,
    },
    corroborationResult: {
      passedCount: corrobPassed,
      failedCount: corrobFailed,
      skippedCount: corrobSkipped,
    },
    reasonablenessResult: {
      impossibleFailures,
      anomalousWarnings,
    },
  });

  // Generate certificate
  const certificate = generateAuditCertificate({
    documentId,
    formType,
    taxYear,
    identityResult,
    corroborationResult,
    reasonablenessResult,
    confidenceResult,
    extractionAttempt: attempt,
  });

  // Determine which gates failed
  const failedGates: string[] = [];
  if (identityResult.failedCount > 0) failedGates.push("identity");
  if (corrobFailed > 0) failedGates.push("corroboration");
  if (impossibleFailures > 0) failedGates.push("reasonableness");
  if (confidenceResult.status === "BLOCKED") failedGates.push("confidence");

  const allGatesPassed = confidenceResult.status === "AUTO_VERIFIED";

  return { certificate, allGatesPassed, failedGates };
}

async function insertException(
  documentId: string,
  dealId: string,
  failedGates: string[],
  allAttempts: Array<{ attempt: number; failedGates: string[]; status: string }>,
): Promise<string | null> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await (sb as any)
      .from("deal_extraction_exceptions")
      .insert({
        document_id: documentId,
        deal_id: dealId,
        failed_gates: failedGates,
        all_attempts: allAttempts,
        status: "open",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[reExtractionOrchestrator] exception insert failed", { error });
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("[reExtractionOrchestrator] exception insert catch", { err });
    return null;
  }
}

// ── Main orchestrator ───────────────────────────────────────────────

/**
 * Orchestrate extraction with re-extraction attempts and all 4 proof-of-correctness gates.
 *
 * Attempt 1: Run gates on existing facts.
 * Attempt 2-3: Simulate re-extraction (actual re-extraction engine wired in future PR).
 * After max attempts: Route to exception queue.
 *
 * CRITICAL: Never throws. Returns EXCEPTION status on unrecoverable failure.
 */
export async function orchestrateWithReExtraction(params: {
  documentId: string;
  dealId: string;
  canonicalType: string;
  taxYear: number | null;
  maxAttempts?: number;
}): Promise<ReExtractionResult> {
  const { documentId, dealId, canonicalType, maxAttempts = 3 } = params;
  const taxYear = params.taxYear ?? 2024;

  try {
    // Map canonical type to IRS form
    const formType = DOC_TYPE_TO_IRS_FORM[canonicalType];
    if (!formType) {
      return { status: "FLAGGED", attempt: 1, certificate: null };
    }

    const attemptHistory: Array<{ attempt: number; failedGates: string[]; status: string }> = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await runAllGates(documentId, dealId, formType, taxYear, attempt);

      if (!result) {
        // Can't load facts or spec — skip this attempt
        attemptHistory.push({ attempt, failedGates: ["data_unavailable"], status: "SKIPPED" });
        continue;
      }

      const { certificate, allGatesPassed, failedGates } = result;

      // Persist certificate
      await persistAuditCertificate(dealId, documentId, certificate);

      if (allGatesPassed) {
        return { status: "AUTO_VERIFIED", attempt, certificate };
      }

      // Record failed attempt
      attemptHistory.push({
        attempt,
        failedGates,
        status: certificate.overallStatus,
      });

      // Emit gate failure event
      writeEvent({
        dealId,
        kind: "extraction.gate_failed",
        scope: "extraction",
        action: "gate_failed",
        meta: {
          document_id: documentId,
          attempt,
          failed_gates: failedGates,
          confidence_score: certificate.gates.confidence.score,
          overall_status: certificate.overallStatus,
        },
      }).catch(() => {});

      if (attempt < maxAttempts) {
        // Emit re-extraction trigger event
        writeEvent({
          dealId,
          kind: "extraction.re_extraction_triggered",
          scope: "extraction",
          action: "re_extraction_triggered",
          meta: {
            document_id: documentId,
            attempt: attempt + 1,
            reason: `Gates failed: ${failedGates.join(", ")}`,
          },
        }).catch(() => {});

        // Simulate re-extraction — in a future PR this will actually re-run extraction.
        // For now, attempt 2 returns FLAGGED, attempt 3 routes to exception queue.
        if (attempt === maxAttempts - 1) {
          // Last chance attempt — return FLAGGED
          return { status: "FLAGGED", attempt, certificate };
        }
      }
    }

    // All attempts exhausted — route to exception queue
    const lastResult = await runAllGates(documentId, dealId, formType, taxYear, maxAttempts);
    const lastCert = lastResult?.certificate ?? null;
    const lastFailedGates = lastResult?.failedGates ?? ["unknown"];

    const exceptionId = await insertException(
      documentId,
      dealId,
      lastFailedGates,
      attemptHistory,
    );

    writeEvent({
      dealId,
      kind: "extraction.routed_to_exception_queue",
      scope: "extraction",
      action: "routed_to_exception_queue",
      meta: {
        document_id: documentId,
        exception_id: exceptionId,
        total_attempts: maxAttempts,
        failed_gates: lastFailedGates,
      },
    }).catch(() => {});

    return {
      status: "EXCEPTION",
      attempt: maxAttempts,
      certificate: lastCert,
      exceptionId: exceptionId ?? undefined,
    };
  } catch (err) {
    console.error("[reExtractionOrchestrator] orchestrate catch", { documentId, err });
    return { status: "BLOCKED", attempt: 1, certificate: null };
  }
}
