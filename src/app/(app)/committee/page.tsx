/**
 * /committee - Credit Committee Command Center
 *
 * Shows active decisions awaiting vote, vote tallies, dissent, minutes.
 * Historical decisions by committee.
 */

import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import Link from "next/link";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
  GlassStatCard,
} from "@/components/layout";

export default async function CommitteePage() {
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;
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
    <GlassShell>
      <GlassPageHeader
        title="Credit Committee"
        subtitle="Active votes, dissent, and minutes"
      />

      {/* Committee Members */}
      <GlassPanel header="Committee Roster" className="mb-6">
        <GlassStatCard
          label="Total Members"
          value={String(members?.length || 0)}
          className="mb-4"
        />
        <div className="grid grid-cols-4 gap-2">
          {members?.map((member: any) => (
            <div
              key={member.id}
              className="text-sm border border-white/10 rounded p-2 bg-white/[0.02]"
            >
              <div className="font-medium text-white">{member.user_id.slice(0, 8)}</div>
              <div className="text-xs text-white/50">{member.role || "Member"}</div>
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* Active Decisions Awaiting Vote */}
      <GlassPanel header="Active Decisions Awaiting Vote" className="mb-6">
        {activeDecisions && activeDecisions.length > 0 ? (
          <div className="space-y-2">
            {activeDecisions.map((decision: any) => (
              <Link
                key={decision.id}
                href={`/deals/${decision.deal_id}/decision?snapshot=${decision.id}`}
                className="flex items-center justify-between p-3 border border-white/10 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              >
                <div>
                  <div className="font-medium text-sm text-white">
                    {decision.deals?.name || `Deal ${decision.deal_id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    Submitted {new Date(decision.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-1 rounded border border-amber-500/30">
                    Awaiting Vote
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/50">No active decisions awaiting committee vote</p>
        )}
      </GlassPanel>

      {/* Recent Committee Decisions */}
      <GlassPanel header="Recent Committee Decisions">
        {recentCommitteeDecisions && recentCommitteeDecisions.length > 0 ? (
          <div className="space-y-2">
            {recentCommitteeDecisions.map((decision: any) => (
              <Link
                key={decision.id}
                href={`/deals/${decision.deal_id}/decision?snapshot=${decision.id}`}
                className="flex items-center justify-between p-3 border border-white/10 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              >
                <div>
                  <div className="font-medium text-sm text-white">
                    {decision.deals?.name || `Deal ${decision.deal_id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    {new Date(decision.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-1 rounded border ${
                      decision.decision?.toLowerCase().includes("approve")
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        : "bg-red-500/20 text-red-300 border-red-500/30"
                    }`}
                  >
                    {decision.decision || "Unknown"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/50">No committee decisions yet</p>
        )}
      </GlassPanel>
    </GlassShell>
  );
}
