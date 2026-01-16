import "server-only";

import { MOODYS_ROWS } from "@/lib/financialSpreads/moodys/mapping";
import { MOODYS_FORMULAS } from "@/lib/financialSpreads/moodys/formulas/registry";

export type RenderInput = {
  spreadType: string; // "T12" | "GLOBAL_CASH_FLOW" | etc
  asOf?: string;
  facts: Record<string, number | null>;
};

export function renderMoodysSpread(input: RenderInput) {
  const generatedAt = new Date().toISOString();

  const rows = MOODYS_ROWS
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((r) => {
      let value: number | null = null;

      if (r.formulaId) {
        const f = MOODYS_FORMULAS[r.formulaId];
        if (!f) {
          throw new Error(`Missing formula registry entry: ${r.formulaId}`);
        }
        // Placeholder: expression evaluation will be implemented with a safe evaluator
        // that only allows references to facts keys and basic operators.
        value = null;
      } else {
        const v = input.facts[r.key];
        value = typeof v === "number" ? v : null;
      }

      return {
        key: r.key,
        label: r.label,
        section: r.section,
        value,
        precision: r.precision ?? null,
        sign: r.sign ?? null,
        sourcePages: r.sourcePages,
        formulaId: r.formulaId ?? null,
      };
    });

  return {
    title: "Moody’s Financial Analysis",
    spread_type: input.spreadType,
    status: "ready",
    generatedAt,
    rows,
  };
}
