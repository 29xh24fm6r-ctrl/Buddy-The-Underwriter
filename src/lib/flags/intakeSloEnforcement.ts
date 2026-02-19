/**
 * Feature Flag — Intake SLO Enforcement
 *
 * Controls ONLY lifecycle blocker emission (intake_health_below_threshold).
 * Monitor detection and governance dashboard always run regardless of this flag.
 *
 * Set ENABLE_INTAKE_SLO_ENFORCEMENT=true to gate lifecycle on intake health.
 */
export function isIntakeSloEnforcementEnabled(): boolean {
  return (
    String(process.env.ENABLE_INTAKE_SLO_ENFORCEMENT ?? "").toLowerCase() ===
    "true"
  );
}
