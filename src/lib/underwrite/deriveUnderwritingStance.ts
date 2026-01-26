/**
 * Underwriting Stance Engine
 *
 * Deterministic derivation of underwriting posture based on evidence.
 * No LLM. No guessing. Just facts → stance.
 *
 * This produces ONE authoritative sentence based on what Buddy knows.
 */

export type UnderwritingStance =
  | "ready_for_underwriting"
  | "blocked_on_cash_flow"
  | "blocked_on_liquidity"
  | "blocked_on_both"
  | "insufficient_information";

export type UnderwritingStanceResult = {
  stance: UnderwritingStance;
  headline: string;
  explanation?: string;
  missingSignals: string[];
};

type ChecklistItemStatus = "missing" | "pending" | "received" | "reviewed_accepted" | "waived" | "needs_review" | "satisfied";

export type ChecklistItemInput = {
  checklist_key: string;
  status: ChecklistItemStatus;
  required?: boolean;
};

export type StanceInputs = {
  checklistItems: ChecklistItemInput[];
  hasFinancialSnapshot: boolean;
};

/**
 * Keys that prove liquidity evidence exists.
 * - PFS_CURRENT: Personal Financial Statement (net worth, liquid assets)
 * - FIN_STMT_BS_YTD: Balance Sheet (current assets, liabilities)
 */
const LIQUIDITY_KEYS = ["PFS_CURRENT", "FIN_STMT_BS_YTD"];

/**
 * Keys that prove cash flow evidence exists.
 * - FIN_STMT_PL_YTD: Profit & Loss / Income Statement
 * - IRS_PERSONAL_3Y: Personal tax returns (shows income history)
 * - IRS_BUSINESS_3Y: Business tax returns (shows revenue/expenses)
 */
const CASH_FLOW_KEYS = ["FIN_STMT_PL_YTD", "IRS_PERSONAL_3Y", "IRS_BUSINESS_3Y"];

/**
 * Check if any of the specified keys have evidence (received or accepted).
 */
function hasEvidence(keys: string[], items: ChecklistItemInput[]): boolean {
  const validStatuses: ChecklistItemStatus[] = ["received", "reviewed_accepted", "satisfied"];
  return items.some(
    (item) => keys.includes(item.checklist_key) && validStatuses.includes(item.status)
  );
}

/**
 * Get the list of missing signals from a key set.
 */
function getMissingSignals(keys: string[], items: ChecklistItemInput[]): string[] {
  const validStatuses: ChecklistItemStatus[] = ["received", "reviewed_accepted", "satisfied"];
  const receivedKeys = new Set(
    items.filter((item) => validStatuses.includes(item.status)).map((item) => item.checklist_key)
  );
  return keys.filter((key) => !receivedKeys.has(key));
}

/**
 * Derive the underwriting stance from available evidence.
 *
 * Decision matrix:
 * - Both liquidity + cash flow → ready_for_underwriting
 * - Liquidity only → blocked_on_cash_flow
 * - Cash flow only → blocked_on_liquidity
 * - Neither → insufficient_information
 *
 * This function:
 * - Never throws
 * - Uses only real checklist state
 * - Cannot hallucinate
 * - Cannot over-promise
 */
export function deriveUnderwritingStance(input: StanceInputs): UnderwritingStanceResult {
  const { checklistItems } = input;

  const hasLiquidity = hasEvidence(LIQUIDITY_KEYS, checklistItems);
  const hasCashFlow = hasEvidence(CASH_FLOW_KEYS, checklistItems);

  const missingLiquidity = getMissingSignals(LIQUIDITY_KEYS, checklistItems);
  const missingCashFlow = getMissingSignals(CASH_FLOW_KEYS, checklistItems);

  // --- Decision matrix ---

  if (hasLiquidity && hasCashFlow) {
    return {
      stance: "ready_for_underwriting",
      headline: "This deal is ready for full underwriting. I don't see any blocking gaps.",
      missingSignals: [],
    };
  }

  if (hasLiquidity && !hasCashFlow) {
    return {
      stance: "blocked_on_cash_flow",
      headline: "I can assess liquidity, but underwriting is blocked on cash flow.",
      explanation: "Upload a Profit & Loss statement or tax returns to validate debt service coverage.",
      missingSignals: missingCashFlow,
    };
  }

  if (!hasLiquidity && hasCashFlow) {
    return {
      stance: "blocked_on_liquidity",
      headline: "I can assess cash flow, but underwriting is blocked on liquidity.",
      explanation: "Upload a balance sheet or personal financial statement to validate borrower net worth.",
      missingSignals: missingLiquidity,
    };
  }

  // Neither present
  return {
    stance: "insufficient_information",
    headline: "The file is incomplete. I need core financials before forming an underwriting view.",
    explanation: "Upload financial statements or tax returns to begin analysis.",
    missingSignals: [...missingLiquidity, ...missingCashFlow],
  };
}

/**
 * Human-readable label for a stance.
 */
export function stanceLabel(stance: UnderwritingStance): string {
  switch (stance) {
    case "ready_for_underwriting":
      return "Ready";
    case "blocked_on_cash_flow":
      return "Blocked (Cash Flow)";
    case "blocked_on_liquidity":
      return "Blocked (Liquidity)";
    case "blocked_on_both":
      return "Blocked";
    case "insufficient_information":
      return "Incomplete";
  }
}

/**
 * Whether the stance indicates the deal can proceed to underwriting.
 */
export function isUnderwritingReady(stance: UnderwritingStance): boolean {
  return stance === "ready_for_underwriting";
}
