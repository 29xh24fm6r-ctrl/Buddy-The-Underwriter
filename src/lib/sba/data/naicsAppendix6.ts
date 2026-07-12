/**
 * SPEC S5 PIV-5 / A-2 — NAICS codes that trigger a Phase I environmental
 * assessment per SOP 50 10 8 Appendix 6. sba.gov is blocked by this
 * environment's proxy policy (same finding as every prior phase's
 * template-ingestion gap), so this is a reasonable subset assembled from
 * the categories the spec itself lists (chemical/petroleum manufacturing,
 * auto-related, dry cleaning, photo processing, mining/quarrying,
 * chemical-using agriculture, metal plating/finishing, printing), not a
 * mechanically-extracted full list from the actual appendix PDF. Ship
 * reasonable subset, surface incompleteness for follow-up (per addendum:
 * "don't block on completeness — rules-as-config means additions are
 * 1-line data updates").
 */

export const NAICS_PHASE_1_TRIGGER_CODES: ReadonlySet<string> = new Set([
  // Chemical / petroleum / metals manufacturing
  "324110", // Petroleum refineries
  "324191", // Petroleum lubricating oil and grease manufacturing
  "325110", // Petrochemical manufacturing
  "325211", // Plastics material and resin manufacturing
  "325998", // All other miscellaneous chemical product manufacturing
  "331110", // Iron and steel mills and ferroalloy manufacturing

  // Gas stations / fuel
  "447110", // Gasoline stations with convenience stores
  "447190", // Other gasoline stations
  "424710", // Petroleum bulk stations and terminals

  // Auto-related (repair, body shops)
  "811111", // General automotive repair
  "811121", // Automotive body, paint, and interior repair and maintenance
  "811198", // All other automotive repair and maintenance

  // Dry cleaning
  "812320", // Drycleaning and laundry services (except coin-operated)

  // Photo processing
  "812921", // Photofinishing laboratories (except one-hour)
  "812922", // One-hour photofinishing

  // Mining / quarrying
  "212000", // Mining (except oil and gas) — category placeholder
  "213000", // Support activities for mining — category placeholder

  // Chemical-using agriculture
  "111110", // Soybean farming
  "111150", // Corn farming

  // Metal plating / finishing
  "332813", // Electroplating, plating, polishing, anodizing, and coloring

  // Printing operations
  "323111", // Commercial printing (except screen and books)
]);

export function isPhase1TriggerNaics(code: string | null | undefined): boolean {
  if (!code) return false;
  return NAICS_PHASE_1_TRIGGER_CODES.has(code);
}
