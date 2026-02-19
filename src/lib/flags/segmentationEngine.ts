/**
 * Segmentation Engine Feature Flag
 *
 * Hard gate controlling whether multi-form PDF splitting is active.
 * When OFF (default), detection still runs and emits telemetry, but no
 * physical splitting occurs. When ON, HIGH-confidence multi-form PDFs
 * are physically split into independent child artifacts.
 *
 * This is the SINGLE SOURCE OF TRUTH for the flag — no other file should
 * read ENABLE_SEGMENTATION_ENGINE directly.
 *
 * Flip procedure: set ENABLE_SEGMENTATION_ENGINE=true in environment, redeploy.
 */
export function isSegmentationEngineEnabled(): boolean {
  return String(process.env.ENABLE_SEGMENTATION_ENGINE ?? "").toLowerCase() === "true";
}
