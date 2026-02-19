/**
 * Feature flag — Intake Signal Telemetry (Phase D)
 *
 * Gates admin dashboard Panel 11 "Intake Signal Intelligence" only.
 * detectSignalDrift() always runs regardless of this flag.
 *
 * ENABLE_INTAKE_SIGNAL_TELEMETRY=true → panel visible
 * ENABLE_INTAKE_SIGNAL_TELEMETRY=false (or absent) → panel hidden
 */

export function isIntakeSignalTelemetryEnabled(): boolean {
  return (
    String(process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY ?? "").toLowerCase() ===
    "true"
  );
}
