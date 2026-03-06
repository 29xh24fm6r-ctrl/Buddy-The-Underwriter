import "server-only";
import type {
  CanonicalFactKey,
  DocumentValidationResult,
  FormSpecification,
  IdentityCheckResult,
  ValidationStatus,
} from "./types";

type FactMap = Record<string, number | null>;

function sumKeys(keys: CanonicalFactKey[], facts: FactMap): {
  value: number | null;
  missingKeys: string[];
} {
  let total = 0;
  const missingKeys: string[] = [];

  for (const key of keys) {
    const v = facts[key];
    if (v === null || v === undefined) {
      missingKeys.push(key);
    } else {
      total += v;
    }
  }

  // If any required key is missing, the sum is unusable
  return missingKeys.length > 0
    ? { value: null, missingKeys }
    : { value: total, missingKeys: [] };
}

function runIdentityCheck(
  check: FormSpecification["identityChecks"][0],
  facts: FactMap,
): IdentityCheckResult {
  const lhs = sumKeys(check.lhs as CanonicalFactKey[], facts);
  const rhs = sumKeys(check.rhs as CanonicalFactKey[], facts);

  // Skip if inputs are missing
  if (lhs.value === null || rhs.value === null) {
    const missing = [...lhs.missingKeys, ...rhs.missingKeys];
    return {
      checkId: check.id,
      description: check.description,
      lhsValue: lhs.value,
      rhsValue: rhs.value,
      delta: null,
      toleranceDollars: check.toleranceDollars,
      passed: false,
      skipped: true,
      skipReason: `Missing facts: ${missing.join(", ")}`,
    };
  }

  const delta = Math.abs(lhs.value - rhs.value);
  const passed = delta <= check.toleranceDollars;

  return {
    checkId: check.id,
    description: check.description,
    lhsValue: lhs.value,
    rhsValue: rhs.value,
    delta,
    toleranceDollars: check.toleranceDollars,
    passed,
    skipped: false,
  };
}

function determineStatus(results: IdentityCheckResult[], spec: FormSpecification): ValidationStatus {
  const required = spec.identityChecks.filter(c => c.requiredForValidation);
  const requiredResults = results.filter(r =>
    required.some(c => c.id === r.checkId)
  );

  const requiredFailed = requiredResults.filter(r => !r.skipped && !r.passed);
  const requiredPassed = requiredResults.filter(r => !r.skipped && r.passed);
  const requiredSkipped = requiredResults.filter(r => r.skipped);

  // All required checks failed — block
  if (requiredFailed.length > 0 && requiredPassed.length === 0) {
    return "BLOCKED";
  }

  // Some required checks failed — flag for analyst
  if (requiredFailed.length > 0) {
    return "FLAGGED";
  }

  // All skipped — can't verify
  if (requiredSkipped.length === required.length) {
    return "PARTIAL";
  }

  // All required passed
  return "VERIFIED";
}

function buildSummary(
  status: ValidationStatus,
  results: IdentityCheckResult[],
): string {
  const failed = results.filter(r => !r.skipped && !r.passed);
  const passed = results.filter(r => !r.skipped && r.passed);
  const skipped = results.filter(r => r.skipped);

  if (status === "VERIFIED") {
    return `All ${passed.length} identity checks passed. Extraction verified.`;
  }

  if (status === "BLOCKED") {
    const details = failed
      .map(r => `${r.checkId}: delta $${r.delta?.toFixed(0)} exceeds tolerance $${r.toleranceDollars}`)
      .join("; ");
    return `${failed.length} identity check(s) FAILED — spread blocked. ${details}`;
  }

  if (status === "FLAGGED") {
    const details = failed
      .map(r => `${r.checkId}: delta $${r.delta?.toFixed(0)}`)
      .join("; ");
    return `${passed.length} checks passed, ${failed.length} failed — analyst review required. ${details}`;
  }

  return `${passed.length} checks passed, ${skipped.length} skipped (missing facts). Partial verification.`;
}

/**
 * Validate extracted financial facts against IRS accounting identities.
 *
 * This is the primary accuracy gate. Run after every extraction.
 * Results feed into Aegis findings and spread generation gating.
 *
 * @param documentId - UUID of the source document
 * @param spec - FormSpecification for this document type and year
 * @param facts - Extracted fact map (canonical key → numeric value)
 * @returns Full validation result with audit trail
 */
export function validateDocumentFacts(
  documentId: string,
  spec: FormSpecification,
  facts: FactMap,
): DocumentValidationResult {
  const checkResults = spec.identityChecks.map(check =>
    runIdentityCheck(check, facts)
  );

  const status = determineStatus(checkResults, spec);
  const summary = buildSummary(status, checkResults);

  return {
    documentId,
    formType: spec.formType,
    taxYear: spec.taxYear,
    status,
    checkResults,
    passedCount: checkResults.filter(r => !r.skipped && r.passed).length,
    failedCount: checkResults.filter(r => !r.skipped && !r.passed).length,
    skippedCount: checkResults.filter(r => r.skipped).length,
    summary,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Determine whether spread generation is allowed given validation results.
 *
 * Policy:
 *   VERIFIED  → allow
 *   PARTIAL   → allow with warning
 *   FLAGGED   → allow with analyst sign-off requirement
 *   BLOCKED   → do not allow
 */
export function isSpreadGenerationAllowed(
  validationResults: DocumentValidationResult[],
): { allowed: boolean; requiresAnalystSignOff: boolean; reason: string } {
  const blocked = validationResults.filter(r => r.status === "BLOCKED");
  const flagged = validationResults.filter(r => r.status === "FLAGGED");

  if (blocked.length > 0) {
    return {
      allowed: false,
      requiresAnalystSignOff: false,
      reason: `${blocked.length} document(s) failed IRS identity validation. Correct extraction before proceeding.`,
    };
  }

  if (flagged.length > 0) {
    return {
      allowed: true,
      requiresAnalystSignOff: true,
      reason: `${flagged.length} document(s) require analyst verification before distribution.`,
    };
  }

  return {
    allowed: true,
    requiresAnalystSignOff: false,
    reason: "All documents verified.",
  };
}
