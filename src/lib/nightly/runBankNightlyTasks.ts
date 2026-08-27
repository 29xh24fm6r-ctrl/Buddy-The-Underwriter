import {
  aggregatePortfolio,
  NoFinalPortfolioDecisionsError,
} from "@/lib/macro/aggregatePortfolio";
import { detectPolicyDrift } from "@/lib/nightly/policyDrift";
import { suggestPolicyUpdates } from "@/lib/nightly/livingPolicy";

export type BankNightlyResult = {
  bank_id: string;
  status: "success" | "error";
  portfolio: "aggregated" | "skipped_no_final_decisions" | "not_run";
  policy_drift: "completed" | "not_run";
  policy_suggestions: "completed" | "not_run";
  error?: string;
};

export type Dependencies = {
  aggregatePortfolio: typeof aggregatePortfolio;
  detectPolicyDrift: typeof detectPolicyDrift;
  suggestPolicyUpdates: typeof suggestPolicyUpdates;
};

const DEFAULT_DEPENDENCIES: Dependencies = {
  aggregatePortfolio,
  detectPolicyDrift,
  suggestPolicyUpdates,
};

export async function runBankNightlyTasks(
  bankId: string,
  deps: Dependencies = DEFAULT_DEPENDENCIES,
): Promise<BankNightlyResult> {
  let portfolio: BankNightlyResult["portfolio"] = "not_run";

  try {
    await deps.aggregatePortfolio(bankId);
    portfolio = "aggregated";
  } catch (error) {
    if (error instanceof NoFinalPortfolioDecisionsError) {
      portfolio = "skipped_no_final_decisions";
    } else {
      return failure(bankId, portfolio, "not_run", "not_run", error);
    }
  }

  try {
    await deps.detectPolicyDrift(bankId);
  } catch (error) {
    return failure(bankId, portfolio, "not_run", "not_run", error);
  }

  try {
    await deps.suggestPolicyUpdates(bankId);
  } catch (error) {
    return failure(bankId, portfolio, "completed", "not_run", error);
  }

  return {
    bank_id: bankId,
    status: "success",
    portfolio,
    policy_drift: "completed",
    policy_suggestions: "completed",
  };
}

function failure(
  bankId: string,
  portfolio: BankNightlyResult["portfolio"],
  policyDrift: BankNightlyResult["policy_drift"],
  policySuggestions: BankNightlyResult["policy_suggestions"],
  error: unknown,
): BankNightlyResult {
  return {
    bank_id: bankId,
    status: "error",
    portfolio,
    policy_drift: policyDrift,
    policy_suggestions: policySuggestions,
    error: error instanceof Error ? error.message : String(error),
  };
}
