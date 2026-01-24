/**
 * /risk - Behavioral & Systemic Risk Dashboard
 *
 * Shows underwriter override concentration, repeated exception patterns,
 * "this will be criticized" flags, silent risk accumulation alerts.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
  GlassStatCard,
  GlassInfoBox,
} from "@/components/layout";

export default async function RiskPage() {
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch decisions with exceptions
  const { data: exceptionsData } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("bank_id", bankId)
    .eq("status", "final")
    .not("exceptions_json", "is", null);

  // Calculate exception concentration by user
  const exceptionsByUser: Record<string, number> = {};
  for (const decision of exceptionsData || []) {
    if ((decision.exceptions_json?.length || 0) > 0) {
      const userId = decision.created_by_user_id || "unknown";
      exceptionsByUser[userId] = (exceptionsByUser[userId] || 0) + 1;
    }
  }

  // Fetch committee override decisions
  const { data: committeeOverrides } = await sb
    .from("decision_snapshots")
    .select("*, credit_committee_votes(vote)")
    .eq("bank_id", bankId)
    .eq("committee_required", true)
    .eq("status", "final");

  // Fetch total decisions count
  const { count: totalDecisions } = await sb
    .from("decision_snapshots")
    .select("*", { count: "exact", head: true })
    .eq("bank_id", bankId)
    .eq("status", "final");

  // Calculate override concentration
  const overrideRate =
    ((committeeOverrides?.length || 0) / Math.max(1, totalDecisions || 1)) * 100;

  return (
    <GlassShell>
      <GlassPageHeader
        title="Risk Intelligence"
        subtitle="Behavioral patterns, systemic risk, and early-warning signals"
      />

      {/* Key Risk Metrics */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <GlassStatCard
          label="Committee Override Rate"
          value={`${overrideRate.toFixed(1)}%`}
        />
        <GlassStatCard
          label="Decisions with Exceptions"
          value={String(exceptionsData?.length || 0)}
        />
      </div>

      {/* Exception Concentration by User */}
      <GlassPanel header="Exception Concentration by Underwriter" className="mb-6">
        <p className="text-sm text-white/60 mb-4">
          Tracks which users are granting the most exceptions. High concentration may indicate
          training needs or policy drift.
        </p>
        {Object.entries(exceptionsByUser).length > 0 ? (
          <div className="space-y-2">
            {Object.entries(exceptionsByUser)
              .sort(([, a], [, b]) => b - a)
              .map(([userId, count]) => (
                <div
                  key={userId}
                  className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/[0.02]"
                >
                  <div className="text-sm">
                    <div className="font-medium text-white">User {userId.slice(0, 8)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-amber-400">{count} exceptions</span>
                    <div className="w-32 bg-white/10 rounded-full h-2">
                      <div
                        className="bg-amber-500 h-2 rounded-full"
                        style={{
                          width: `${Math.min(100, (count / Math.max(...Object.values(exceptionsByUser))) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-white/50">No exception data available</p>
        )}
      </GlassPanel>

      {/* Early Warning Signals */}
      <GlassPanel header="Early-Warning Signals" className="mb-6">
        <p className="text-sm text-white/60 mb-4">
          Patterns that may attract regulatory scrutiny:
        </p>
        <div className="space-y-3">
          {overrideRate > 20 && (
            <GlassInfoBox
              icon="warning"
              title={`High Committee Override Rate (${overrideRate.toFixed(1)}%)`}
              variant="error"
            >
              Rate exceeds 20% threshold. Examiners may question policy effectiveness.
            </GlassInfoBox>
          )}

          {Object.values(exceptionsByUser).some((count) => count > 5) && (
            <GlassInfoBox icon="warning" title="Exception Concentration Detected" variant="warning">
              One or more underwriters have granted 5+ exceptions. Consider peer review.
            </GlassInfoBox>
          )}

          {overrideRate <= 20 && !Object.values(exceptionsByUser).some((count) => count > 5) && (
            <p className="text-sm text-white/50 italic">
              No early-warning signals detected. Portfolio appears within normal parameters.
            </p>
          )}
        </div>
      </GlassPanel>

      {/* Future: Stress Test Integration */}
      <GlassPanel header="Coming Soon">
        <div className="space-y-2 text-sm text-white/60">
          <div>• Policy drift detection (actual vs. stated policy)</div>
          <div>• Silent risk accumulation alerts</div>
          <div>• Counterfactual decision analysis</div>
          <div>• Stress test scenario builder</div>
        </div>
      </GlassPanel>
    </GlassShell>
  );
}
