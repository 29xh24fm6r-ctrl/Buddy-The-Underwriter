import type { SpreadPrereq } from "@/lib/financialSpreads/templates/templateTypes";
import type { FactsVisibility } from "@/lib/financialFacts/getVisibleFacts";

/**
 * Evaluate whether a spread type's prerequisites are satisfied.
 * Pure function — no DB calls.
 */
export function evaluatePrereq(
  prereq: SpreadPrereq,
  factsVis: FactsVisibility,
  rentRollRowCount: number,
): { ready: boolean; missing: string[] } {
  const missing: string[] = [];

  if (prereq.facts?.fact_types) {
    for (const ft of prereq.facts.fact_types) {
      if (!factsVis.byFactType[ft] || factsVis.byFactType[ft] === 0) {
        missing.push(`fact_type:${ft}`);
      }
    }
  }

  // OR semantics: at least one of fact_types_any must be present
  if (prereq.facts?.fact_types_any) {
    const anyPresent = prereq.facts.fact_types_any.some(
      (ft) => (factsVis.byFactType[ft] ?? 0) > 0,
    );
    if (!anyPresent) {
      missing.push(`any_fact_type:${prereq.facts.fact_types_any.join("|")}`);
    }
  }

  if (prereq.facts?.fact_keys) {
    // Future: check individual key presence against facts query
    if (prereq.facts.min_count && factsVis.total < prereq.facts.min_count) {
      missing.push(`min_count:${prereq.facts.min_count}`);
    }
  }

  if (prereq.tables?.rent_roll_rows && rentRollRowCount === 0) {
    missing.push("table:rent_roll_rows");
  }

  return { ready: missing.length === 0, missing };
}
