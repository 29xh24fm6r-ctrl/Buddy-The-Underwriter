/** Fail-closed policy drift detection for the nightly governance worker. */

type DatabaseError = { message?: string } | null;

export type PolicyRule = { rules_json?: Record<string, unknown> | null };
export type DecisionSnapshot = {
  policy_eval_json?: Record<string, unknown> | null;
};
export type PolicyDriftFinding = {
  bank_id: string;
  rule_key: string;
  expected_value: string;
  observed_value: string;
  drift_rate: number;
  violation_count: number;
  total_decisions: number;
};

export type PolicyDriftDependencies = {
  readApprovedRules: (
    bankId: string,
  ) => Promise<{ data: PolicyRule[] | null; error: DatabaseError }>;
  readFinalDecisions: (
    bankId: string,
  ) => Promise<{ data: DecisionSnapshot[] | null; error: DatabaseError }>;
  insertFinding: (
    finding: PolicyDriftFinding,
  ) => Promise<{ error: DatabaseError }>;
};

export type PolicyDriftSummary = {
  status: "completed" | "skipped_no_rules" | "skipped_no_decisions";
  evaluatedRules: number;
  significantFindings: number;
  persistedFindings: number;
};

export class PolicyDriftRunError extends Error {
  readonly name = "PolicyDriftRunError";

  constructor(
    message: string,
    readonly failures: string[],
    readonly persistedFindings: number,
  ) {
    super(message);
  }
}

export async function detectPolicyDrift(
  bankId: string,
  dependencies?: PolicyDriftDependencies,
): Promise<PolicyDriftSummary> {
  const deps = dependencies ?? (await loadDefaultDependencies());
  const rulesResult = await deps.readApprovedRules(bankId);

  if (rulesResult.error) {
    throw runError(
      "Policy drift approved-policy read failed for bank " + bankId,
      "approved_policy_read",
      rulesResult.error,
      0,
    );
  }

  const rules = rulesResult.data ?? [];
  if (rules.length === 0) {
    return emptySummary("skipped_no_rules");
  }

  const snapshotsResult = await deps.readFinalDecisions(bankId);
  if (snapshotsResult.error) {
    throw runError(
      "Policy drift final-decision read failed for bank " + bankId,
      "final_decision_read",
      snapshotsResult.error,
      0,
    );
  }

  const snapshots = snapshotsResult.data ?? [];
  if (snapshots.length === 0) {
    return emptySummary("skipped_no_decisions");
  }

  const findings: PolicyDriftFinding[] = [];
  let evaluatedRules = 0;

  for (const rule of rules) {
    for (const [ruleKey, expectedValue] of Object.entries(
      rule.rules_json ?? {},
    )) {
      evaluatedRules += 1;
      const violationCount = snapshots.reduce((count, snapshot) => {
        const actualValue = snapshot.policy_eval_json?.[ruleKey];
        return typeof expectedValue === "number" &&
          typeof actualValue === "number" &&
          actualValue < expectedValue
          ? count + 1
          : count;
      }, 0);
      const driftRate = violationCount / snapshots.length;

      if (driftRate > 0.05) {
        findings.push({
          bank_id: bankId,
          rule_key: ruleKey,
          expected_value: String(expectedValue),
          observed_value: violationCount + " violations",
          drift_rate: driftRate,
          violation_count: violationCount,
          total_decisions: snapshots.length,
        });
      }
    }
  }

  const failures: string[] = [];
  let persistedFindings = 0;

  for (const finding of findings) {
    try {
      const result = await deps.insertFinding(finding);
      if (result.error) {
        failures.push(finding.rule_key + ": " + errorMessage(result.error));
      } else {
        persistedFindings += 1;
      }
    } catch (error) {
      failures.push(finding.rule_key + ": " + unknownErrorMessage(error));
    }
  }

  if (failures.length > 0) {
    throw new PolicyDriftRunError(
      "Policy drift evidence persistence failed for bank " +
        bankId +
        ": " +
        failures.join("; "),
      failures,
      persistedFindings,
    );
  }

  return {
    status: "completed",
    evaluatedRules,
    significantFindings: findings.length,
    persistedFindings,
  };
}

async function loadDefaultDependencies(): Promise<PolicyDriftDependencies> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();

  return {
    async readApprovedRules(bankId) {
      const result = await sb
        .from("policy_extracted_rules")
        .select("*")
        .eq("bank_id", bankId)
        .eq("approved", true);
      return {
        data: (result.data as PolicyRule[] | null) ?? null,
        error: result.error,
      };
    },
    async readFinalDecisions(bankId) {
      const result = await sb
        .from("decision_snapshots")
        .select("*")
        .eq("bank_id", bankId)
        .eq("status", "final");
      return {
        data: (result.data as DecisionSnapshot[] | null) ?? null,
        error: result.error,
      };
    },
    async insertFinding(finding) {
      const result = await sb.from("policy_drift_findings").insert(finding);
      return { error: result.error };
    },
  };
}

function emptySummary(
  status: "skipped_no_rules" | "skipped_no_decisions",
): PolicyDriftSummary {
  return {
    status,
    evaluatedRules: 0,
    significantFindings: 0,
    persistedFindings: 0,
  };
}

function runError(
  prefix: string,
  step: string,
  error: { message?: string },
  persisted: number,
): PolicyDriftRunError {
  const detail = errorMessage(error);
  return new PolicyDriftRunError(
    prefix + ": " + detail,
    [step + ": " + detail],
    persisted,
  );
}

function errorMessage(error: { message?: string }): string {
  return error.message ?? "unknown database error";
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
