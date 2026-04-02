/**
 * Experiment Guardrails — Phase 66C, System 7 (pure)
 *
 * Enforces experiment safety rules: forbidden domains and
 * definition validation. Pure function — no DB, no server-only.
 */

/* ------------------------------------------------------------------ */
/*  Forbidden domains                                                  */
/* ------------------------------------------------------------------ */

export const FORBIDDEN_DOMAINS = [
  "permissions",
  "tenant_isolation",
  "omega_state",
  "evidence_integrity",
  "visibility_logic",
] as const;

export type ForbiddenDomain = (typeof FORBIDDEN_DOMAINS)[number];

/* ------------------------------------------------------------------ */
/*  validateExperimentDomain                                           */
/* ------------------------------------------------------------------ */

export function validateExperimentDomain(
  domain: string,
): { allowed: boolean; reason?: string } {
  if ((FORBIDDEN_DOMAINS as readonly string[]).includes(domain)) {
    return {
      allowed: false,
      reason: `Domain "${domain}" is forbidden for experimentation — it affects core safety invariants.`,
    };
  }
  return { allowed: true };
}

/* ------------------------------------------------------------------ */
/*  validateExperimentDefinition                                       */
/* ------------------------------------------------------------------ */

export function validateExperimentDefinition(
  def: { variants: string[]; kpi: string; rollbackCondition: string; guardrail: string },
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!def.variants || !Array.isArray(def.variants) || def.variants.length < 2) {
    errors.push("Experiment must have at least 2 variants");
  }

  if (!def.kpi || typeof def.kpi !== "string" || def.kpi.trim().length === 0) {
    errors.push("KPI is required");
  }

  if (!def.rollbackCondition || typeof def.rollbackCondition !== "string" || def.rollbackCondition.trim().length === 0) {
    errors.push("Rollback condition is required");
  }

  if (!def.guardrail || typeof def.guardrail !== "string" || def.guardrail.trim().length === 0) {
    errors.push("Guardrail is required");
  }

  return { valid: errors.length === 0, errors };
}
