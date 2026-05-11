import "server-only";

import type { SpreadTemplate } from "@/lib/financialSpreads/templates/templateTypes";
import type { SpreadType } from "@/lib/financialSpreads/types";
import { balanceSheetTemplate } from "@/lib/financialSpreads/templates/balanceSheet";
import { globalCashFlowTemplate } from "@/lib/financialSpreads/templates/globalCashFlow";
import { personalFinancialStatementTemplate } from "@/lib/financialSpreads/templates/personalFinancialStatement";
import { personalIncomeTemplate } from "@/lib/financialSpreads/templates/personalIncome";
import { rentRollTemplate } from "@/lib/financialSpreads/templates/rentRoll";
import { t12Template } from "@/lib/financialSpreads/templates/t12";
import { renderStandardSpread } from "@/lib/financialSpreads/standard/renderStandardSpread";

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
    priority: 99,
    prerequisites: () => ({ note: "Placeholder template — no prerequisites" }),
    columns: ["Line Item", "Value"],
    render: () => {
      const generatedAt = new Date().toISOString();

      return {
        schema_version: 1,
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
            values: ["Standard template pending; pipeline is operational."],
          },
        ],
        meta: { template: "placeholder", version: 1 },
      };
    },
  };
}

// Placeholder templates keep the system end-to-end operational.
// Replace these with standard templates (layout + formulas) once the fixture is integrated.
export function getSpreadTemplate(type: SpreadType): SpreadTemplate | null {
  if (type === "BALANCE_SHEET") return balanceSheetTemplate();
  if (type === "GLOBAL_CASH_FLOW") return globalCashFlowTemplate();
  if (type === "PERSONAL_INCOME") return personalIncomeTemplate();
  if (type === "PERSONAL_FINANCIAL_STATEMENT") return personalFinancialStatementTemplate();
  if (type === "T12") return t12Template();
  if (type === "RENT_ROLL") return rentRollTemplate();
  if (type === "STANDARD") return standardTemplate();
  if (type === "CLASSIC_PDF") return classicPdfTemplate();
  return null;
}

/**
 * SPEC-B3 — CLASSIC_PDF template registration.
 *
 * CLASSIC_PDF is NOT rendered via the template system. It uses its own
 * pipeline: loadClassicSpreadData → renderClassicSpread (PDFKit).
 *
 * This template exists so that:
 *   - enqueueSpreadRecompute validates CLASSIC_PDF as a known type
 *   - Placeholder rows get the correct spread_version
 *   - The spreadsProcessor's prereq check passes (no facts required)
 *
 * The render() function throws — the processor dispatches CLASSIC_PDF
 * to classicPdfWorker.renderClassicPdfSpread() instead.
 */
function classicPdfTemplate(): SpreadTemplate {
  return {
    spreadType: "CLASSIC_PDF",
    title: "Classic Financial Spread (PDF)",
    version: 1,
    priority: 100, // runs last — depends on all other spreads completing
    prerequisites: () => ({
      note: "CLASSIC_PDF uses its own preflight (BS + IS row count), not fact-level prerequisites",
    }),
    columns: [],
    render: () => {
      throw new Error(
        "CLASSIC_PDF must not be rendered via the template system — use classicPdfWorker.renderClassicPdfSpread()",
      );
    },
  };
}

function standardTemplate(): SpreadTemplate {
  return {
    spreadType: "STANDARD",
    title: "Financial Analysis",
    version: 1,
    priority: 10,
    prerequisites: () => ({
      facts: {
        fact_types_any: ["INCOME_STATEMENT", "BALANCE_SHEET", "TAX_RETURN", "PERSONAL_INCOME"],
        min_count: 1,
      },
      note: "Requires at least one financial fact from any source (IS, BS, tax return, or personal income)",
    }),
    columns: ["Line Item", "Value"],
    render: (args) => renderStandardSpread({
      dealId: args.dealId,
      bankId: args.bankId,
      facts: args.facts,
    }),
  };
}
