/**
 * Calibration Curve Fetch + TTL Cache — Server Layer
 *
 * Server-only. Queries `classification_calibration_curve_v1` view.
 * 5-minute in-memory TTL cache to avoid hammering the view on every match.
 *
 * On error: returns stale cache if available, empty array otherwise.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CalibrationCurve, SpineTierKey } from "./autoAttachThresholds";
import type { ConfidenceBand } from "../calibrateConfidence";

// ---------------------------------------------------------------------------
// TTL Cache (5 minutes)
// ---------------------------------------------------------------------------

const TTL_MS = 5 * 60 * 1000;

let cachedCurve: CalibrationCurve = [];
let cachedAt = 0;

/**
 * Clear the calibration curve cache. For tests/admin use.
 */
export function clearCalibrationCurveCache(): void {
  cachedCurve = [];
  cachedAt = 0;
}

// ---------------------------------------------------------------------------
// Tier + Band normalization
// ---------------------------------------------------------------------------

const VALID_TIERS = new Set<SpineTierKey>([
  "tier1_anchor",
  "tier2_structural",
  "tier3_llm",
  "fallback",
]);

const VALID_BANDS = new Set<ConfidenceBand>(["HIGH", "MEDIUM", "LOW"]);

function normalizeTier(raw: string | null): SpineTierKey | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (VALID_TIERS.has(t as SpineTierKey)) return t as SpineTierKey;
  // Handle potential naming variations
  if (t === "tier1" || t === "anchor") return "tier1_anchor";
  if (t === "tier2" || t === "structural") return "tier2_structural";
  if (t === "tier3" || t === "llm") return "tier3_llm";
  return null;
}

function normalizeBand(raw: string | null): ConfidenceBand | null {
  if (!raw) return null;
  const b = raw.trim().toUpperCase();
  if (VALID_BANDS.has(b as ConfidenceBand)) return b as ConfidenceBand;
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the calibration curve from the backtesting view.
 *
 * Returns up to 12 cells (4 tiers x 3 bands).
 * On error, returns stale cache or empty array (fail-safe).
 */
export async function fetchCalibrationCurve(): Promise<CalibrationCurve> {
  const now = Date.now();

  // Return cached if still fresh
  if (now - cachedAt < TTL_MS && cachedCurve.length > 0) {
    return cachedCurve;
  }

  try {
    const sb = supabaseAdmin();
    const { data, error } = await (sb as any)
      .from("classification_calibration_curve_v1")
      .select("band, tier, total, overrides, override_rate");

    if (error) {
      console.warn("[fetchCalibrationCurve] query error — returning stale cache", {
        error: error.message,
      });
      return cachedCurve;
    }

    const curve: CalibrationCurve = [];

    for (const row of data ?? []) {
      const tier = normalizeTier(row.tier);
      const band = normalizeBand(row.band);
      if (!tier || !band) continue;

      curve.push({
        tier,
        band,
        total: Number(row.total) || 0,
        overrides: Number(row.overrides) || 0,
        overrideRate: Number(row.override_rate) || 0,
      });
    }

    // Update cache
    cachedCurve = curve;
    cachedAt = now;

    return curve;
  } catch (e: any) {
    console.warn("[fetchCalibrationCurve] unexpected error — returning stale cache", {
      error: e?.message,
    });
    return cachedCurve;
  }
}
