export type BankNightlyResult = {
  bank_id: string;
  status: "success" | "error";
  portfolio: "aggregated" | "skipped_no_final_decisions" | "not_run";
  policy_drift: "completed" | "not_run";
  policy_suggestions: "completed" | "not_run";
  error?: string;
};

export type Dependencies = {
  aggregatePortfolio: typeof import("@/lib/macro/aggregatePortfolio").aggregatePortfolio;
  detectPolicyDrift: typeof import("@/lib/nightly/policyDrift").detectPolicyDrift;
  suggestPolicyUpdates: typeof import("@/lib/nightly/livingPolicy").suggestPolicyUpdates;
};

export async function runBankNightlyTasks(
  bankId: string,
  dependencies?: Dependencies,
): Promise<BankNightlyResult> {
  const deps = dependencies ?? (await loadDefaultDependencies());
  let portfolio: BankNightlyResult["portfolio"] = "not_run";

  try {
    await deps.aggregatePortfolio(bankId);
    portfolio = "aggregated";
  } catch (error) {
    if (isNoFinalPortfolioDecisionsError(error)) {
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

async function loadDefaultDependencies(): Promise<Dependencies> {
  const [portfolio, drift, policy] = await Promise.all([
    import("@/lib/macro/aggregatePortfolio"),
    import("@/lib/nightly/policyDrift"),
    import("@/lib/nightly/livingPolicy"),
  ]);

  return {
    aggregatePortfolio: portfolio.aggregatePortfolio,
    detectPolicyDrift: drift.detectPolicyDrift,
    suggestPolicyUpdates: policy.suggestPolicyUpdates,
  };
}

function isNoFinalPortfolioDecisionsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "NO_FINAL_PORTFOLIO_DECISIONS"
  );
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
