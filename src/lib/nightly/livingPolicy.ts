/** Fail-closed living-credit-policy suggestion generation. */

type DatabaseError = { message?: string } | null;

export type PolicyDriftFinding = {
  rule_key: string;
  expected_value?: unknown;
  observed_value?: unknown;
  drift_rate?: number | null;
};
export type PolicySuggestion = {
  suggested_change: string;
  rationale: string;
};
export type SuggestionResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export type LivingPolicyDependencies = {
  readRecentFindings: (
    bankId: string,
    sinceIso: string,
  ) => Promise<{ data: PolicyDriftFinding[] | null; error: DatabaseError }>;
  generateSuggestion: (input: {
    ruleKey: string;
    expectedValue: unknown;
    averageDriftRate: number;
    findings: PolicyDriftFinding[];
  }) => Promise<SuggestionResult>;
  insertSuggestion: (row: {
    bank_id: string;
    rule_key: string;
    current_value: string;
    suggested_change: string;
    rationale: string;
    approved: false;
  }) => Promise<{ error: DatabaseError }>;
};

export type LivingPolicySummary = {
  status: "completed" | "skipped_no_findings";
  eligibleRules: number;
  generatedSuggestions: number;
  persistedSuggestions: number;
};

export class LivingPolicyRunError extends Error {
  readonly name = "LivingPolicyRunError";

  constructor(
    message: string,
    readonly failures: string[],
    readonly generatedSuggestions: number,
    readonly persistedSuggestions: number,
  ) {
    super(message);
  }
}

export async function suggestPolicyUpdates(
  bankId: string,
  dependencies?: LivingPolicyDependencies,
): Promise<LivingPolicySummary> {
  const deps = dependencies ?? (await loadDefaultDependencies());
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const findingsResult = await deps.readRecentFindings(
    bankId,
    since.toISOString(),
  );

  if (findingsResult.error) {
    const detail = errorMessage(findingsResult.error);
    throw new LivingPolicyRunError(
      "Living policy drift read failed for bank " + bankId + ": " + detail,
      ["drift_read: " + detail],
      0,
      0,
    );
  }

  const driftFindings = findingsResult.data ?? [];
  if (driftFindings.length === 0) {
    return {
      status: "skipped_no_findings",
      eligibleRules: 0,
      generatedSuggestions: 0,
      persistedSuggestions: 0,
    };
  }

  const failures: string[] = [];
  const driftByRule: Record<string, PolicyDriftFinding[]> = {};

  for (const finding of driftFindings) {
    const ruleKey = String(finding.rule_key ?? "").trim();
    if (!ruleKey) {
      failures.push("invalid finding: missing rule_key");
      continue;
    }
    (driftByRule[ruleKey] ??= []).push(finding);
  }

  let eligibleRules = 0;
  let generatedSuggestions = 0;
  let persistedSuggestions = 0;

  for (const [ruleKey, findings] of Object.entries(driftByRule)) {
    const averageDriftRate =
      findings.reduce(
        (sum, finding) => sum + Number(finding.drift_rate ?? 0),
        0,
      ) / findings.length;
    if (averageDriftRate < 0.1) continue;
    eligibleRules += 1;

    try {
      const result = await deps.generateSuggestion({
        ruleKey,
        expectedValue: findings[0]?.expected_value,
        averageDriftRate,
        findings,
      });
      if (!result.ok) {
        failures.push(ruleKey + ": provider: " + result.error);
        continue;
      }

      const suggestion = parseSuggestion(result.result);
      generatedSuggestions += 1;
      const insertResult = await deps.insertSuggestion({
        bank_id: bankId,
        rule_key: ruleKey,
        current_value: String(findings[0]?.expected_value ?? ""),
        suggested_change: suggestion.suggested_change,
        rationale: suggestion.rationale,
        approved: false,
      });

      if (insertResult.error) {
        failures.push(
          ruleKey + ": persistence: " + errorMessage(insertResult.error),
        );
      } else {
        persistedSuggestions += 1;
      }
    } catch (error) {
      failures.push(ruleKey + ": " + unknownErrorMessage(error));
    }
  }

  if (failures.length > 0) {
    throw new LivingPolicyRunError(
      "Living policy suggestion run failed for bank " +
        bankId +
        ": " +
        failures.join("; "),
      failures,
      generatedSuggestions,
      persistedSuggestions,
    );
  }

  return {
    status: "completed",
    eligibleRules,
    generatedSuggestions,
    persistedSuggestions,
  };
}

async function loadDefaultDependencies(): Promise<LivingPolicyDependencies> {
  const [{ supabaseAdmin }, { aiJson }] = await Promise.all([
    import("@/lib/supabase/admin"),
    import("@/lib/ai/openai"),
  ]);
  const sb = supabaseAdmin();

  return {
    async readRecentFindings(bankId, sinceIso) {
      const result = await sb
        .from("policy_drift_findings")
        .select("*")
        .eq("bank_id", bankId)
        .gte("created_at", sinceIso)
        .order("drift_rate", { ascending: false })
        .limit(10);
      return {
        data: (result.data as PolicyDriftFinding[] | null) ?? null,
        error: result.error,
      };
    },
    async generateSuggestion(input) {
      return aiJson<PolicySuggestion>({
        scope: "governance",
        action: "policy-drift-suggestion",
        system:
          "You are a chief credit officer analyzing policy drift. Suggest a policy update with clear rationale.",
        user: JSON.stringify({
          rule_key: input.ruleKey,
          expected_value: input.expectedValue,
          drift_rate: input.averageDriftRate,
          findings: input.findings.map((finding) => ({
            observed: finding.observed_value,
            drift_rate: finding.drift_rate,
          })),
        }),
        jsonSchemaHint: JSON.stringify({
          type: "object",
          properties: {
            suggested_change: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["suggested_change", "rationale"],
        }),
      });
    },
    async insertSuggestion(row) {
      const result = await sb.from("policy_update_suggestions").insert(row);
      return { error: result.error };
    },
  };
}

function parseSuggestion(value: unknown): PolicySuggestion {
  if (typeof value !== "object" || value === null) {
    throw new Error("provider returned a non-object suggestion");
  }
  const candidate = value as Record<string, unknown>;
  const suggestedChange =
    typeof candidate.suggested_change === "string"
      ? candidate.suggested_change.trim()
      : "";
  const rationale =
    typeof candidate.rationale === "string"
      ? candidate.rationale.trim()
      : "";
  if (!suggestedChange || !rationale) {
    throw new Error(
      "provider returned an incomplete suggested_change/rationale payload",
    );
  }
  return { suggested_change: suggestedChange, rationale };
}

function errorMessage(error: { message?: string }): string {
  return error.message ?? "unknown database error";
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
