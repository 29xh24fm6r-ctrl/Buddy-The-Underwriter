/**
 * Moody’s Financial Analysis — Formula Registry (Locked)
 *
 * IMPORTANT:
 * - All computed lines MUST use a formulaId from this registry.
 * - Do not change formulas without updating the golden fixture tests.
 */

export type MoodysFormula = {
  id: string;
  expr: string;
  precision?: number;
  sourcePages: number[];
};

export const MOODYS_FORMULAS: Record<string, MoodysFormula> = {
  // TODO: Fill with every computed line’s formula, exactly matching Moody’s.
  // Example structure (replace with real Moody’s definitions):
  // WORKING_CAPITAL: { id:"WORKING_CAPITAL", expr:"TOTAL_CURRENT_ASSETS - TOTAL_CURRENT_LIABILITIES", precision:0, sourcePages:[1] },
};
