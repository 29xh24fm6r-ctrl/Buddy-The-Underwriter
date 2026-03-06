import "server-only";

import type { DocumentValidationResult } from "./types";
import type { CorroborationResult } from "./corroborationEngine";
import type { ReasonablenessCheck } from "./reasonablenessEngine";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type AuditCertificate = {
  documentId: string;
  formType: string;
  taxYear: number;
  extractionAttempt: number;
  generatedAt: string;
  gates: {
    identity: {
      status: DocumentValidationResult["status"];
      passedCount: number;
      failedCount: number;
      skippedCount: number;
      summary: string;
      checkResults: DocumentValidationResult["checkResults"];
    };
    corroboration: {
      passedCount: number;
      failedCount: number;
      skippedCount: number;
      results: CorroborationResult[];
    };
    reasonableness: {
      impossibleFailures: number;
      anomalousWarnings: number;
      results: ReasonablenessCheck[];
    };
    confidence: {
      score: number;
      status: string;
      breakdown: object;
    };
  };
  overallStatus: string;
};

/**
 * Generate a structured audit certificate from all gate results.
 * Pure aggregation — no DB calls.
 */
export function generateAuditCertificate(params: {
  documentId: string;
  formType: string;
  taxYear: number;
  identityResult: DocumentValidationResult;
  corroborationResult: CorroborationResult[];
  reasonablenessResult: ReasonablenessCheck[];
  confidenceResult: { score: number; status: string; breakdown: object };
  extractionAttempt: number;
}): AuditCertificate {
  const {
    documentId,
    formType,
    taxYear,
    identityResult,
    corroborationResult,
    reasonablenessResult,
    confidenceResult,
    extractionAttempt,
  } = params;

  const corrobPassed = corroborationResult.filter(r => !r.skipped && r.passed).length;
  const corrobFailed = corroborationResult.filter(r => !r.skipped && !r.passed).length;
  const corrobSkipped = corroborationResult.filter(r => r.skipped).length;

  const impossibleFailures = reasonablenessResult.filter(
    r => r.severity === "IMPOSSIBLE" && !r.passed,
  ).length;
  const anomalousWarnings = reasonablenessResult.filter(
    r => r.severity === "ANOMALOUS" && !r.passed,
  ).length;

  return {
    documentId,
    formType,
    taxYear,
    extractionAttempt,
    generatedAt: new Date().toISOString(),
    gates: {
      identity: {
        status: identityResult.status,
        passedCount: identityResult.passedCount,
        failedCount: identityResult.failedCount,
        skippedCount: identityResult.skippedCount,
        summary: identityResult.summary,
        checkResults: identityResult.checkResults,
      },
      corroboration: {
        passedCount: corrobPassed,
        failedCount: corrobFailed,
        skippedCount: corrobSkipped,
        results: corroborationResult,
      },
      reasonableness: {
        impossibleFailures,
        anomalousWarnings,
        results: reasonablenessResult,
      },
      confidence: {
        score: confidenceResult.score,
        status: confidenceResult.status,
        breakdown: confidenceResult.breakdown,
      },
    },
    overallStatus: confidenceResult.status,
  };
}

/**
 * Persist an audit certificate to deal_document_audit_certificates.
 * Server-only — writes to DB. Never throws.
 */
export async function persistAuditCertificate(
  dealId: string,
  documentId: string,
  certificate: AuditCertificate,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = supabaseAdmin();

    const row = {
      document_id: documentId,
      deal_id: dealId,
      verification_status: certificate.overallStatus,
      confidence_score: certificate.gates.confidence.score,
      gates_passed: {
        identity: certificate.gates.identity.status === "VERIFIED",
        corroboration: certificate.gates.corroboration.failedCount === 0,
        reasonableness: certificate.gates.reasonableness.impossibleFailures === 0,
      },
      extraction_attempt: certificate.extractionAttempt,
      certificate: certificate as unknown as Record<string, unknown>,
    };

    const { error } = await sb
      .from("deal_document_audit_certificates")
      .upsert(row, { onConflict: "document_id" });

    if (error) {
      console.error("[auditCertificate] persist failed", { documentId, error });
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err: any) {
    console.error("[auditCertificate] persist catch", { documentId, err });
    return { ok: false, error: err?.message || "Unknown error" };
  }
}
