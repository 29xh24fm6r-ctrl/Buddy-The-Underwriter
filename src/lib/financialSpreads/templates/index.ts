import "server-only";

import type { SpreadTemplate } from "@/lib/financialSpreads/templates/templateTypes";
import type { SpreadType } from "@/lib/financialSpreads/types";

function placeholderTemplate(type: SpreadType): SpreadTemplate {
  const title =
    type === "T12"
      ? "Trailing 12 (Placeholder)"
      : type === "RENT_ROLL"
        ? "Rent Roll (Placeholder)"
        : "Global Cash Flow (Placeholder)";

  return {
    spreadType: type,
    title,
    version: 1,
    columns: ["Line Item", "Value"],
    render: () => {
      const generatedAt = new Date().toISOString();

      return {
        title,
        spread_type: type,
        status: "ready",
        generatedAt,
        asOf: null,
        columns: ["Line Item", "Value"],
        rows: [
          {
            key: "placeholder",
            label: "Placeholder",
            values: [
              "Moody’s-exact template pending; pipeline is operational.",
              null,
            ],
          },
        ],
        meta: { template: "placeholder", version: 1 },
      };
    },
  };
}

// Placeholder templates keep the system end-to-end operational.
// Replace these with Moody’s-exact templates (layout + formulas) once the fixture is integrated.
export function getSpreadTemplate(type: SpreadType): SpreadTemplate | null {
  if (type === "T12" || type === "RENT_ROLL" || type === "GLOBAL_CASH_FLOW") {
    return placeholderTemplate(type);
  }
  return null;
}
