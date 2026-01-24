/**
 * /governance - Governance Command Center
 *
 * Canonical entry point for all governance features.
 * Shows policy compliance, exception trends, committee behavior, attestation status.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import Link from "next/link";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
  GlassStatCard,
  GlassActionCard,
} from "@/components/layout";

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
    <GlassShell>
      <GlassPageHeader
        title="Governance Command Center"
        subtitle="Policy compliance, attestation status, and committee governance"
      />

      {/* Governance Status Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* Attestation Policy */}
        <GlassPanel header="Attestation Policy">
          {attestationPolicy ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/60">Required Count:</span>
                <span className="font-medium text-white">{attestationPolicy.required_count}</span>
              </div>
              {attestationPolicy.required_roles && (
                <div className="flex justify-between">
                  <span className="text-white/60">Required Roles:</span>
                  <span className="font-medium text-white">
                    {attestationPolicy.required_roles.join(", ")}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-white/50">Not configured</p>
          )}
        </GlassPanel>

        {/* Committee Policy */}
        <GlassPanel header="Committee Policy">
          {committeePolicy ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/60">Status:</span>
                <span
                  className={`font-medium ${committeePolicy.enabled ? "text-emerald-400" : "text-white/40"}`}
                >
                  {committeePolicy.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Rules:</span>
                <span className="font-medium text-white">
                  {Object.keys(committeePolicy.rules_json || {}).length} defined
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/50">Not configured</p>
          )}
        </GlassPanel>

        {/* Committee Members */}
        <GlassStatCard
          label="Committee Members"
          value={String(committeeMembers?.length || 0)}
        />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <GlassActionCard
          icon="analytics"
          iconColor="text-blue-400"
          title="Portfolio Dashboard"
          description="System-wide risk metrics"
          href="/portfolio"
          actionLabel="View Portfolio"
        />
        <GlassActionCard
          icon="groups"
          iconColor="text-purple-400"
          title="Committee Center"
          description="Voting, dissent, minutes"
          href="/committee"
          actionLabel="View Committee"
        />
        <GlassActionCard
          icon="policy"
          iconColor="text-emerald-400"
          title="Living Credit Policy"
          description="Policy docs & extracted rules"
          href="/policy"
          actionLabel="View Policy"
        />
        <GlassActionCard
          icon="verified_user"
          iconColor="text-amber-400"
          title="Examiner Mode"
          description="Read-only regulator view"
          href="/examiner"
          actionLabel="Enter Examiner Mode"
        />
      </div>

      {/* Recent Decisions */}
      <GlassPanel header="Recent Decisions">
        <div className="space-y-2">
          {recentDecisions && recentDecisions.length > 0 ? (
            recentDecisions.map((decision: any) => (
              <Link
                key={decision.id}
                href={`/deals/${decision.deal_id}/decision`}
                className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      decision.status === "final" ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  <div className="text-sm">
                    <div className="font-medium text-white">{decision.decision || "Pending"}</div>
                    <div className="text-xs text-white/50">
                      {new Date(decision.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-white/50">Deal #{decision.deal_id.slice(0, 8)}</div>
              </Link>
            ))
          ) : (
            <p className="text-sm text-white/50">No decisions yet</p>
          )}
        </div>
      </GlassPanel>
    </GlassShell>
  );
}
