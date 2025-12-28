/**
 * /committee - Credit Committee Command Center
 * 
 * Shows active decisions awaiting vote, vote tallies, dissent, minutes.
 * Historical decisions by committee.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import Link from "next/link";

export default async function CommitteePage() {
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch decisions requiring committee
  const { data: activeDecisions } = await sb
    .from("decision_snapshots")
    .select("*, deals(name)")
    .eq("bank_id", bankId)
    .eq("committee_required", true)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  // Fetch recent committee decisions
  const { data: recentCommitteeDecisions } = await sb
    .from("decision_snapshots")
    .select("*, deals(name)")
    .eq("bank_id", bankId)
    .eq("committee_required", true)
    .eq("status", "final")
    .order("created_at", { ascending: false })
    .limit(10);

  // Fetch committee members
  const { data: members } = await sb
    .from("bank_credit_committee_members")
    .select("*")
    .eq("bank_id", bankId);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Credit Committee</h1>
        <p className="text-sm text-gray-600 mt-1">
          Active votes, dissent, and minutes
        </p>
      </div>

      {/* Committee Members */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Committee Roster</h2>
        <div className="text-2xl font-bold text-purple-600 mb-2">
          {members?.length || 0} Members
        </div>
        <div className="grid grid-cols-4 gap-2">
          {members?.map((member: any) => (
            <div key={member.id} className="text-sm border rounded p-2">
              <div className="font-medium">{member.user_id.slice(0, 8)}</div>
              <div className="text-xs text-gray-500">{member.role || "Member"}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Decisions Awaiting Vote */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Active Decisions Awaiting Vote</h2>
        {activeDecisions && activeDecisions.length > 0 ? (
          <div className="space-y-2">
            {activeDecisions.map((decision: any) => (
              <Link
                key={decision.id}
                href={`/deals/${decision.deal_id}/decision?snapshot=${decision.id}`}
                className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 transition-colors"
              >
                <div>
                  <div className="font-medium text-sm">
                    {decision.deals?.name || `Deal ${decision.deal_id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Submitted {new Date(decision.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                    Awaiting Vote
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No active decisions awaiting committee vote</p>
        )}
      </div>

      {/* Recent Committee Decisions */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Recent Committee Decisions</h2>
        {recentCommitteeDecisions && recentCommitteeDecisions.length > 0 ? (
          <div className="space-y-2">
            {recentCommitteeDecisions.map((decision: any) => (
              <Link
                key={decision.id}
                href={`/deals/${decision.deal_id}/decision?snapshot=${decision.id}`}
                className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 transition-colors"
              >
                <div>
                  <div className="font-medium text-sm">
                    {decision.deals?.name || `Deal ${decision.deal_id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(decision.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${
                    decision.decision?.toLowerCase().includes("approve")
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}>
                    {decision.decision || "Unknown"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No committee decisions yet</p>
        )}
      </div>
    </div>
  );
}
