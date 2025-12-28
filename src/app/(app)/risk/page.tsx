/**
 * /risk - Behavioral & Systemic Risk Dashboard
 * 
 * Shows underwriter override concentration, repeated exception patterns,
 * "this will be criticized" flags, silent risk accumulation alerts.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

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

  // Calculate override concentration
  const overrideRate = (
    (committeeOverrides?.length || 0) / 
    Math.max(1, (await sb.from("decision_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("bank_id", bankId)
      .eq("status", "final")).count || 1)
  ) * 100;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Risk Intelligence</h1>
        <p className="text-sm text-gray-600 mt-1">
          Behavioral patterns, systemic risk, and early-warning signals
        </p>
      </div>

      {/* Key Risk Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-sm text-gray-600 mb-1">Committee Override Rate</div>
          <div className="text-3xl font-bold text-red-600">
            {overrideRate.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {committeeOverrides?.length || 0} of {
              (await sb.from("decision_snapshots")
                .select("*", { count: "exact", head: true })
                .eq("bank_id", bankId)
                .eq("status", "final")).count || 0
            } decisions required committee
          </div>
        </div>

        <div className="border rounded-lg p-4 bg-white">
          <div className="text-sm text-gray-600 mb-1">Decisions with Exceptions</div>
          <div className="text-3xl font-bold text-amber-600">
            {exceptionsData?.length || 0}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Active exception patterns detected
          </div>
        </div>
      </div>

      {/* Exception Concentration by User */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Exception Concentration by Underwriter</h2>
        <p className="text-sm text-gray-600 mb-4">
          Tracks which users are granting the most exceptions. High concentration may indicate
          training needs or policy drift.
        </p>
        {Object.entries(exceptionsByUser).length > 0 ? (
          <div className="space-y-2">
            {Object.entries(exceptionsByUser)
              .sort(([, a], [, b]) => b - a)
              .map(([userId, count]) => (
                <div key={userId} className="flex items-center justify-between p-2 border rounded">
                  <div className="text-sm">
                    <div className="font-medium">User {userId.slice(0, 8)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-amber-600">{count} exceptions</span>
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-amber-500 h-2 rounded-full"
                        style={{
                          width: `${Math.min(100, (count / Math.max(...Object.values(exceptionsByUser))) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No exception data available</p>
        )}
      </div>

      {/* Early Warning Signals */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Early-Warning Signals</h2>
        <p className="text-sm text-gray-600 mb-4">
          Patterns that may attract regulatory scrutiny:
        </p>
        <div className="space-y-3">
          {overrideRate > 20 && (
            <div className="border-l-4 border-red-500 bg-red-50 p-3">
              <div className="font-medium text-sm text-red-800">
                ⚠️ High Committee Override Rate ({overrideRate.toFixed(1)}%)
              </div>
              <div className="text-xs text-red-700 mt-1">
                Rate exceeds 20% threshold. Examiners may question policy effectiveness.
              </div>
            </div>
          )}

          {Object.values(exceptionsByUser).some(count => count > 5) && (
            <div className="border-l-4 border-yellow-500 bg-yellow-50 p-3">
              <div className="font-medium text-sm text-yellow-800">
                ⚠️ Exception Concentration Detected
              </div>
              <div className="text-xs text-yellow-700 mt-1">
                One or more underwriters have granted 5+ exceptions. Consider peer review.
              </div>
            </div>
          )}

          {!overrideRate && !Object.keys(exceptionsByUser).length && (
            <div className="text-sm text-gray-500 italic">
              No early-warning signals detected. Portfolio appears within normal parameters.
            </div>
          )}
        </div>
      </div>

      {/* Future: Stress Test Integration */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <h2 className="text-lg font-semibold mb-3">Coming Soon</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <div>• Policy drift detection (actual vs. stated policy)</div>
          <div>• Silent risk accumulation alerts</div>
          <div>• Counterfactual decision analysis</div>
          <div>• Stress test scenario builder</div>
        </div>
      </div>
    </div>
  );
}
