/**
 * Adaptive Auto-Attach Thresholding Feature Flag
 *
 * Controls whether the matching engine uses per-tier x band adaptive
 * thresholds instead of the two static thresholds (0.90/0.85).
 *
 * When OFF (default): current behavior unchanged — static thresholds.
 * When ON: per-tier baselines apply (tighter than static for tier2+).
 *   With sufficient calibration data, thresholds may loosen toward
 *   empirically validated levels.
 *
 * This is the SINGLE SOURCE OF TRUTH for the flag — no other file should
 * read ENABLE_ADAPTIVE_AUTO_ATTACH directly.
 *
 * Flip procedure: set ENABLE_ADAPTIVE_AUTO_ATTACH=true in environment, redeploy.
 */
export function isAdaptiveAutoAttachEnabled(): boolean {
  return String(process.env.ENABLE_ADAPTIVE_AUTO_ATTACH ?? "").toLowerCase() === "true";
}
