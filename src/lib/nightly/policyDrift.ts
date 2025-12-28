/**
 * Policy Drift Detection (Nightly Job)
 * 
 * Compares actual decisions to stated policy rules.
 * Identifies where the bank is "behaving as if" policy is different than stated.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function detectPolicyDrift(bankId: string) {
  const sb = supabaseAdmin();

  // Fetch approved policy rules
  const { data: rules } = await sb
    .from("policy_extracted_rules")
    .select("*")
    .eq("bank_id", bankId)
    .eq("approved", true);

  if (!rules || rules.length === 0) {
    console.log("No approved policy rules for drift detection");
    return;
  }

  // Fetch final decisions
  const { data: snapshots } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("bank_id", bankId)
    .eq("status", "final");

  if (!snapshots || snapshots.length === 0) {
    console.log("No final decisions for drift detection");
    return;
  }

  const totalDecisions = snapshots.length;

  // Analyze each policy rule
  for (const rule of rules) {
    const rulesJson = rule.rules_json || {};
    
    for (const [ruleKey, expectedValue] of Object.entries(rulesJson)) {
      // Count violations
      let violationCount = 0;

      for (const snap of snapshots) {
        const actualValue = snap.policy_eval_json?.[ruleKey];
        
        // Simple threshold comparison (would be more sophisticated in production)
        if (actualValue !== undefined && actualValue !== null) {
          if (typeof expectedValue === 'number' && typeof actualValue === 'number') {
            // For numeric rules (e.g., DSCR >= 1.25)
            if (actualValue < expectedValue) {
              violationCount++;
            }
          }
        }
      }

      const driftRate = violationCount / totalDecisions;

      // Only store if drift is significant (>5%)
      if (driftRate > 0.05) {
        await sb.from("policy_drift_findings").insert({
          bank_id: bankId,
          rule_key: ruleKey,
          expected_value: String(expectedValue),
          observed_value: `${violationCount} violations`,
          drift_rate: driftRate,
          violation_count: violationCount,
          total_decisions: totalDecisions
        });

        console.log(`Drift detected: ${ruleKey} - ${(driftRate * 100).toFixed(1)}% violation rate`);
      }
    }
  }
}
