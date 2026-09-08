/**
 * K1_TO_ENTITY input selection — pure, no DB.
 *
 * The cross-period fact map keeps one value per key regardless of tax year, so
 * the entity OBI from the newest return was being compared with a K-1 from an
 * older one (2025 OBI 133,679 vs 2024 K-1 178,938 → a 45,259 "hard conflict"
 * on a sole-owner S-corp whose K-1 matches every year).
 */

/**
 * Pick the entity OBI and the K-1 inputs from the SAME tax year — the latest
 * year that carries an entity OBI — falling back to the cross-period map only
 * for a key that year does not have at all.
 */
export function selectK1CheckInputs(
  periodFacts: Map<string, Record<string, number | null>>,
  allFacts: Record<string, number | null>,
): { year: string | null; entityObi: number | null; k1Income: number | null; k1Pct: number | null } {
  const years = [...periodFacts.keys()]
    .filter((y) => y !== "unknown" && /^\d{4}$/.test(y))
    .sort()
    .reverse();
  for (const year of years) {
    const m = periodFacts.get(year)!;
    const obi = m["ORDINARY_BUSINESS_INCOME"];
    if (obi === null || obi === undefined) continue;
    return {
      year,
      entityObi: obi,
      k1Income: m["K1_ORDINARY_INCOME"] ?? null,
      k1Pct: m["K1_OWNERSHIP_PCT"] ?? allFacts["K1_OWNERSHIP_PCT"] ?? null,
    };
  }
  return {
    year: null,
    entityObi: allFacts["ORDINARY_BUSINESS_INCOME"] ?? null,
    k1Income: allFacts["K1_ORDINARY_INCOME"] ?? null,
    k1Pct: allFacts["K1_OWNERSHIP_PCT"] ?? null,
  };
}

