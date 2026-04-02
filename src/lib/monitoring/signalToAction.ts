/* ------------------------------------------------------------------ */
/*  Signal-to-Action — server module                                   */
/* ------------------------------------------------------------------ */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type MonitoringSignal = {
  signalType: string;
  severity: string;
  direction: string;
  sourceContext: Record<string, unknown>;
};

export type ActionRecommendation = {
  audience: "banker" | "borrower";
  action: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  signalType: string;
};

/* ------------------------------------------------------------------ */
/*  Signal → action mapping                                            */
/* ------------------------------------------------------------------ */

type ActionTemplate = {
  bankerAction: string;
  bankerRationale: string;
  borrowerAction: string;
  borrowerRationale: string;
  priority: "high" | "medium" | "low";
};

const SIGNAL_ACTIONS: Record<string, ActionTemplate> = {
  ar_deterioration: {
    bankerAction: "Review AR aging report and assess concentration risk.",
    bankerRationale:
      "Deteriorating receivables may indicate customer payment difficulties or revenue quality issues.",
    borrowerAction:
      "Focus on collecting outstanding invoices, especially those over 60 days.",
    borrowerRationale:
      "Getting paid faster improves your cash position and makes your financials look stronger to lenders.",
    priority: "high",
  },
  revenue_decline: {
    bankerAction:
      "Request updated financials and discuss revenue trend with borrower.",
    bankerRationale:
      "Revenue decline may affect debt service capacity and covenant compliance.",
    borrowerAction:
      "Review sales pipeline and customer retention. Identify specific drivers of the decline.",
    borrowerRationale:
      "Understanding why revenue dropped is the first step to turning it around.",
    priority: "high",
  },
  expense_spike: {
    bankerAction:
      "Request expense breakdown and verify whether the increase is one-time or recurring.",
    bankerRationale:
      "Unexpected expense increases compress margins and may affect cash flow projections.",
    borrowerAction:
      "Review recent expenses for unusual or one-time items. If recurring, identify areas to cut.",
    borrowerRationale:
      "If this is a one-time cost, document it. If ongoing, address it before it erodes your margins.",
    priority: "medium",
  },
  dscr_decline: {
    bankerAction:
      "Recalculate DSCR with updated figures and assess covenant proximity.",
    bankerRationale:
      "Declining DSCR signals reduced ability to service debt and may trigger covenant concerns.",
    borrowerAction:
      "Prioritize actions that improve cash flow: reduce discretionary spending and accelerate collections.",
    borrowerRationale:
      "Your ability to cover loan payments is slipping. Quick wins on expenses and collections can help.",
    priority: "high",
  },
  occupancy_decline: {
    bankerAction:
      "Review rent roll for move-out patterns and assess lease expiration schedule.",
    bankerRationale:
      "Declining occupancy reduces NOI and may breach loan covenants or LTV requirements.",
    borrowerAction:
      "Evaluate rental pricing versus market and consider leasing incentives for quick occupancy improvement.",
    borrowerRationale:
      "Empty units mean lost income. Review if rents are competitive and invest in filling vacancies quickly.",
    priority: "high",
  },
  margin_compression: {
    bankerAction:
      "Analyze margin trend and determine whether cost-driven or revenue-driven.",
    bankerRationale:
      "Margin compression may indicate pricing pressure or cost control issues that affect long-term viability.",
    borrowerAction:
      "Review both pricing and costs. Identify the biggest drivers of the margin change.",
    borrowerRationale:
      "Your profit per dollar of revenue is shrinking. Find out if it is prices, costs, or both.",
    priority: "medium",
  },
  cash_reserve_decline: {
    bankerAction:
      "Verify current cash balances and assess liquidity runway.",
    bankerRationale:
      "Declining cash reserves reduce the borrower's ability to handle unexpected expenses or revenue shortfalls.",
    borrowerAction:
      "Build cash reserves by deferring non-essential spending and accelerating receivable collections.",
    borrowerRationale:
      "A cash cushion protects you from surprises. Focus on building it back up.",
    priority: "medium",
  },
  covenant_proximity: {
    bankerAction:
      "Calculate distance to covenant breach and prepare early intervention plan.",
    bankerRationale:
      "Approaching covenant limits requires proactive management to avoid default scenarios.",
    borrowerAction:
      "Work with your lender to understand which metrics need attention and create an action plan.",
    borrowerRationale:
      "Your loan agreement has requirements you need to meet. Getting ahead of any issues is much better than reacting after the fact.",
    priority: "high",
  },
  positive_trend: {
    bankerAction:
      "Note positive trajectory. Consider for relationship expansion or improved terms at renewal.",
    bankerRationale:
      "Positive trends indicate improving credit quality and potential for deepening the relationship.",
    borrowerAction:
      "Keep up the momentum. This positive trend strengthens your position for future financing needs.",
    borrowerRationale:
      "Things are moving in the right direction. Staying consistent builds trust with your lender.",
    priority: "low",
  },
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function convertSignalToActions(
  _sb: SupabaseClient,
  signal: MonitoringSignal,
  _dealId: string,
  _bankId: string,
): Promise<ActionRecommendation[]> {
  const template = SIGNAL_ACTIONS[signal.signalType];

  if (!template) {
    // Unknown signal type — return generic recommendations
    return [
      {
        audience: "banker",
        action: `Review monitoring signal: ${signal.signalType} (${signal.severity} severity, ${signal.direction} direction).`,
        rationale:
          "An unrecognized monitoring signal was detected. Manual review is recommended.",
        priority: signal.severity === "critical" ? "high" : "medium",
        signalType: signal.signalType,
      },
    ];
  }

  const recommendations: ActionRecommendation[] = [
    {
      audience: "banker",
      action: template.bankerAction,
      rationale: template.bankerRationale,
      priority: template.priority,
      signalType: signal.signalType,
    },
    {
      audience: "borrower",
      action: template.borrowerAction,
      rationale: template.borrowerRationale,
      priority: template.priority,
      signalType: signal.signalType,
    },
  ];

  // Elevate priority for critical severity
  if (signal.severity === "critical") {
    for (const rec of recommendations) {
      rec.priority = "high";
    }
  }

  return recommendations;
}
