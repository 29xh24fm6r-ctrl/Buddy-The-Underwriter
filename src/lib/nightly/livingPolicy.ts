/**
 * Living Credit Policy (AI Suggestions)
 * 
 * Analyzes policy drift findings and suggests policy updates.
 * This is the "self-healing policy" feature.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/openai";

export async function suggestPolicyUpdates(bankId: string) {
  const sb = supabaseAdmin();

  // Fetch recent drift findings (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: driftFindings } = await sb
    .from("policy_drift_findings")
    .select("*")
    .eq("bank_id", bankId)
    .gte("created_at", thirtyDaysAgo.toISOString())
    .order("drift_rate", { ascending: false })
    .limit(10);

  if (!driftFindings || driftFindings.length === 0) {
    console.log("No significant drift findings for policy suggestions");
    return;
  }

  // Group by rule_key
  const driftByRule: Record<string, typeof driftFindings> = {};
  for (const finding of driftFindings) {
    if (!driftByRule[finding.rule_key]) {
      driftByRule[finding.rule_key] = [];
    }
    driftByRule[finding.rule_key].push(finding);
  }

  // Generate suggestions for each drifting rule
  for (const [ruleKey, findings] of Object.entries(driftByRule)) {
    const avgDriftRate = findings.reduce((sum, f) => sum + (f.drift_rate || 0), 0) / findings.length;

    // Only suggest updates for significant drift (>10%)
    if (avgDriftRate < 0.1) continue;

    try {
      const suggestion = await aiJson({
        scope: "governance",
        action: "policy-drift-suggestion",
        system: "You are a chief credit officer analyzing policy drift. Suggest a policy update with clear rationale.",
        user: JSON.stringify({
          rule_key: ruleKey,
          expected_value: findings[0].expected_value,
          drift_rate: avgDriftRate,
          findings: findings.map(f => ({
            observed: f.observed_value,
            drift_rate: f.drift_rate
          }))
        }),
        jsonSchemaHint: JSON.stringify({
          type: "object",
          properties: {
            suggested_change: { type: "string" },
            rationale: { type: "string" }
          },
          required: ["suggested_change", "rationale"]
        })
      });

      if (!suggestion.ok) {
        console.error(`Failed to generate suggestion for ${ruleKey}: ${suggestion.error}`);
        continue;
      }

      // Store suggestion (requires human approval)
      await sb.from("policy_update_suggestions").insert({
        bank_id: bankId,
        rule_key: ruleKey,
        current_value: findings[0].expected_value,
        suggested_change: suggestion.result.suggested_change,
        rationale: suggestion.result.rationale,
        approved: false
      });

      console.log(`Policy suggestion created for ${ruleKey}`);
    } catch (error) {
      console.error(`Error generating suggestion for ${ruleKey}:`, error);
    }
  }
}
