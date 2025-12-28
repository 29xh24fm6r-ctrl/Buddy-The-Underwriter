/**
 * /governance - Governance Command Center
 * 
 * Canonical entry point for all governance features.
 * Shows policy compliance, exception trends, committee behavior, attestation status.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import Link from "next/link";

export default async function GovernancePage() {
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch governance metrics
  const { data: attestationPolicy } = await sb
    .from("bank_attestation_policies")
    .select("*")
    .eq("bank_id", bankId)
    .maybeSingle();

  const { data: committeePolicy } = await sb
    .from("bank_credit_committee_policies")
    .select("*")
    .eq("bank_id", bankId)
    .maybeSingle();

  const { data: committeeMembers } = await sb
    .from("bank_credit_committee_members")
    .select("*")
    .eq("bank_id", bankId);

  const { data: recentDecisions } = await sb
    .from("decision_snapshots")
    .select("id, deal_id, decision, status, created_at")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Governance Command Center</h1>
        <p className="text-sm text-gray-600 mt-1">
          Policy compliance, attestation status, and committee governance
        </p>
      </div>

      {/* Governance Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        {/* Attestation Policy */}
        <div className="border rounded-lg p-4 bg-white">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Attestation Policy</h3>
          {attestationPolicy ? (
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-gray-600">Required Count:</span>{" "}
                <span className="font-medium">{attestationPolicy.required_count}</span>
              </div>
              {attestationPolicy.required_roles && (
                <div>
                  <span className="text-gray-600">Required Roles:</span>{" "}
                  <span className="font-medium">{attestationPolicy.required_roles.join(", ")}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Not configured</p>
          )}
        </div>

        {/* Committee Policy */}
        <div className="border rounded-lg p-4 bg-white">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Committee Policy</h3>
          {committeePolicy ? (
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-gray-600">Status:</span>{" "}
                <span className={`font-medium ${committeePolicy.enabled ? "text-green-600" : "text-gray-400"}`}>
                  {committeePolicy.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Rules:</span>{" "}
                <span className="font-medium">{Object.keys(committeePolicy.rules_json || {}).length} defined</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Not configured</p>
          )}
        </div>

        {/* Committee Members */}
        <div className="border rounded-lg p-4 bg-white">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Committee Members</h3>
          <div className="text-2xl font-bold text-purple-600">
            {committeeMembers?.length || 0}
          </div>
          <p className="text-xs text-gray-500 mt-1">Active members</p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Quick Links</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/portfolio"
            className="border rounded-lg p-3 hover:bg-gray-50 transition-colors"
          >
            <div className="font-medium text-sm">Portfolio Dashboard</div>
            <div className="text-xs text-gray-600 mt-1">System-wide risk metrics</div>
          </Link>
          
          <Link
            href="/committee"
            className="border rounded-lg p-3 hover:bg-gray-50 transition-colors"
          >
            <div className="font-medium text-sm">Committee Center</div>
            <div className="text-xs text-gray-600 mt-1">Voting, dissent, minutes</div>
          </Link>

          <Link
            href="/policy"
            className="border rounded-lg p-3 hover:bg-gray-50 transition-colors"
          >
            <div className="font-medium text-sm">Living Credit Policy</div>
            <div className="text-xs text-gray-600 mt-1">Policy docs & extracted rules</div>
          </Link>

          <Link
            href="/examiner"
            className="border rounded-lg p-3 hover:bg-gray-50 transition-colors"
          >
            <div className="font-medium text-sm">Examiner Mode</div>
            <div className="text-xs text-gray-600 mt-1">Read-only regulator view</div>
          </Link>
        </div>
      </div>

      {/* Recent Decisions */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Recent Decisions</h2>
        <div className="space-y-2">
          {recentDecisions && recentDecisions.length > 0 ? (
            recentDecisions.map((decision: any) => (
              <Link
                key={decision.id}
                href={`/deals/${decision.deal_id}/decision`}
                className="flex items-center justify-between p-2 border rounded hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    decision.status === "final" ? "bg-green-500" : "bg-yellow-500"
                  }`} />
                  <div className="text-sm">
                    <div className="font-medium">{decision.decision || "Pending"}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(decision.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">Deal #{decision.deal_id.slice(0, 8)}</div>
              </Link>
            ))
          ) : (
            <p className="text-sm text-gray-500">No decisions yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
