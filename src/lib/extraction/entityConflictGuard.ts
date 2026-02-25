/**
 * Entity Conflict Guard (E2).
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * Detects conflicts between EIN/SSN extracted from structured JSON
 * and the resolved entity in the entity graph.
 *
 * If extracted EIN/SSN conflicts with the resolved entity → ENTITY_CONFLICT.
 * This is a pre-persistence check — documents with conflicts should be
 * routed to review, not auto-processed.
 */

// ── Types ─────────────────────────────────────────────────────────────

export type EntityConflictResult = {
  hasConflict: boolean;
  conflictType: "ein_mismatch" | "ssn_mismatch" | null;
  detail: string | null;
  extractedIdentifier: string | null;
  resolvedIdentifier: string | null;
};

// ── EIN/SSN Extraction from Structured JSON ─────────────────────────

/**
 * Extract EIN from structured assist output.
 * Looks for formField with name "ein" or entity with type "ein".
 */
export function extractEinFromStructured(
  structuredJson: unknown,
): string | null {
  if (!structuredJson || typeof structuredJson !== "object") return null;

  const sj = structuredJson as Record<string, unknown>;

  // Check formFields
  if (Array.isArray(sj.formFields)) {
    for (const field of sj.formFields) {
      if (
        field &&
        typeof field === "object" &&
        (field as any).name?.toLowerCase() === "ein" &&
        typeof (field as any).value === "string"
      ) {
        return normalizeEin((field as any).value);
      }
    }
  }

  // Check entities
  if (Array.isArray(sj.entities)) {
    for (const entity of sj.entities) {
      if (
        entity &&
        typeof entity === "object" &&
        (entity as any).type?.toLowerCase() === "ein" &&
        typeof (entity as any).mentionText === "string"
      ) {
        return normalizeEin((entity as any).mentionText);
      }
    }
  }

  return null;
}

/**
 * Extract SSN from structured assist output.
 * Looks for formField with name "ssn" or entity with type "ssn".
 */
export function extractSsnFromStructured(
  structuredJson: unknown,
): string | null {
  if (!structuredJson || typeof structuredJson !== "object") return null;

  const sj = structuredJson as Record<string, unknown>;

  // Check formFields
  if (Array.isArray(sj.formFields)) {
    for (const field of sj.formFields) {
      if (
        field &&
        typeof field === "object" &&
        (field as any).name?.toLowerCase() === "ssn" &&
        typeof (field as any).value === "string"
      ) {
        return normalizeSsn((field as any).value);
      }
    }
  }

  return null;
}

// ── Conflict Detection ──────────────────────────────────────────────

/**
 * Check if extracted EIN/SSN conflicts with the resolved entity.
 *
 * Pure function — no DB, no side effects.
 *
 * Returns { hasConflict: false } if:
 * - No extracted identifier
 * - No resolved identifier
 * - Identifiers match
 *
 * Returns { hasConflict: true } only if BOTH exist and DIFFER.
 */
export function detectEntityConflict(args: {
  extractedEin: string | null;
  resolvedEin: string | null;
  extractedSsn: string | null;
  resolvedSsn: string | null;
}): EntityConflictResult {
  // EIN conflict check
  if (args.extractedEin && args.resolvedEin) {
    if (args.extractedEin !== args.resolvedEin) {
      return {
        hasConflict: true,
        conflictType: "ein_mismatch",
        detail: `Extracted EIN (${maskIdentifier(args.extractedEin)}) differs from resolved entity EIN (${maskIdentifier(args.resolvedEin)})`,
        extractedIdentifier: maskIdentifier(args.extractedEin),
        resolvedIdentifier: maskIdentifier(args.resolvedEin),
      };
    }
  }

  // SSN conflict check
  if (args.extractedSsn && args.resolvedSsn) {
    if (args.extractedSsn !== args.resolvedSsn) {
      return {
        hasConflict: true,
        conflictType: "ssn_mismatch",
        detail: `Extracted SSN (${maskIdentifier(args.extractedSsn)}) differs from resolved entity SSN (${maskIdentifier(args.resolvedSsn)})`,
        extractedIdentifier: maskIdentifier(args.extractedSsn),
        resolvedIdentifier: maskIdentifier(args.resolvedSsn),
      };
    }
  }

  return {
    hasConflict: false,
    conflictType: null,
    detail: null,
    extractedIdentifier: null,
    resolvedIdentifier: null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Normalize EIN to XX-XXXXXXX format.
 * Strips all non-digit chars, then formats as 2-7.
 */
function normalizeEin(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 9) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/**
 * Normalize SSN to XXX-XX-XXXX format.
 * Strips all non-digit chars, then formats as 3-2-4.
 */
function normalizeSsn(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 9) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * Mask an identifier for logging (show last 4 only).
 */
function maskIdentifier(id: string): string {
  if (id.length <= 4) return "****";
  return "***" + id.slice(-4);
}
