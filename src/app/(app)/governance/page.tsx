/**
 * /governance - Governance Command Center
 *
 * Canonical entry point for all governance features.
 * Shows policy compliance, exception trends, committee behavior, attestation status.
 *
 * AI Governance Sections:
 * 1. AI Risk Assessment — Use Case Registry
 * 2. Validation Summary — Autonomy levels + planner status
 * 3. Monitoring & Drift Report — Mission execution stats
 * 4. Audit Appendix — Ledger events + correlation IDs
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
import { GovernanceUseCaseRegistry } from "@/components/governance/GovernanceUseCaseRegistry";
import { GovernanceExportButton } from "@/components/governance/GovernanceExportButton";
import { GovernanceViewTracker } from "@/components/governance/GovernanceViewTracker";

export default async function GovernancePage() {
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // ── Existing governance metrics ───────────────────────────
  const [
    { data: attestationPolicy },
    { data: committeePolicy },
    { data: committeeMembers },
    { data: recentDecisions },
  ] = await Promise.all([
    sb.from("bank_attestation_policies").select("*").eq("bank_id", bankId).maybeSingle(),
    sb.from("bank_credit_committee_policies").select("*").eq("bank_id", bankId).maybeSingle(),
    sb.from("bank_credit_committee_members").select("*").eq("bank_id", bankId),
    sb.from("decision_snapshots").select("id, deal_id, decision, status, created_at").eq("bank_id", bankId).order("created_at", { ascending: false }).limit(10),
  ]);

  // ── AI Governance metrics ────────────────────────────────
  const [
    { data: useCases },
    { data: recentMissions },
    { data: recentLedger },
  ] = await Promise.all([
    sb.from("buddy_ai_use_cases").select("*").order("mission_type"),
    sb.from("buddy_research_missions")
      .select("id, mission_type, status, deal_id, created_at, completed_at")
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(50),
    sb.from("deal_pipeline_ledger")
      .select("id, deal_id, event_key, status, ui_message, meta, created_at")
      .eq("bank_id", bankId)
      .like("event_key", "buddy.%")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  // ── Compute AI stats ─────────────────────────────────────
  const missions = recentMissions ?? [];
  const completedMissions = missions.filter((m: any) => m.status === "complete");
  const failedMissions = missions.filter((m: any) => m.status === "failed");
  const runningMissions = missions.filter((m: any) => m.status === "running" || m.status === "queued");

  // Mission type distribution
  const missionTypeCounts = missions.reduce((acc: Record<string, number>, m: any) => {
    acc[m.mission_type] = (acc[m.mission_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const ledgerEvents = recentLedger ?? [];

  return (
    <GlassShell>
      <GovernanceViewTracker />
      <GlassPageHeader
        title="Governance Command Center"
        subtitle="Policy compliance, AI governance, attestation status, and committee governance"
      />

      {/* ═══ Section 1: AI Risk Assessment ═══ */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-400">security</span>
            AI Risk Assessment
          </h2>
          <GovernanceExportButton bankId={bankId} />
        </div>
        <GlassPanel header="AI Use Case Registry">
          {useCases && useCases.length > 0 ? (
            <GovernanceUseCaseRegistry useCases={useCases as any} />
          ) : (
            <p className="text-sm text-white/50">
              No AI use cases registered. Run the governance migration to seed the registry.
            </p>
          )}
        </GlassPanel>
      </div>

      {/* ═══ Section 2: Validation Summary ═══ */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-emerald-400">verified</span>
          Validation Summary
        </h2>
        <div className="grid grid-cols-4 gap-4 mb-4">
          <GlassStatCard label="Total Missions" value={String(missions.length)} />
          <GlassStatCard label="Completed" value={String(completedMissions.length)} />
          <GlassStatCard label="Failed" value={String(failedMissions.length)} />
          <GlassStatCard label="In Progress" value={String(runningMissions.length)} />
        </div>
        <GlassPanel header="Mission Type Distribution">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(missionTypeCounts).length > 0 ? (
              Object.entries(missionTypeCounts)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([mType, count]) => {
                  const useCase = (useCases ?? []).find((uc: any) => uc.mission_type === mType);
                  return (
                    <div
                      key={mType}
                      className="flex items-center justify-between p-2 rounded-lg border border-white/5 bg-white/[0.02]"
                    >
                      <span className="text-sm text-white/80">
                        {(useCase as any)?.name ?? mType.replace(/_/g, " ")}
                      </span>
                      <span className="text-sm font-mono text-white/60">{count as number}</span>
                    </div>
                  );
                })
            ) : (
              <p className="text-sm text-white/50 col-span-2">No missions executed yet</p>
            )}
          </div>
        </GlassPanel>
      </div>

      {/* ═══ Section 3: Monitoring & Drift Report ═══ */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-amber-400">monitoring</span>
          Monitoring &amp; Drift Report
        </h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
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

        {/* Failed missions (drift indicator) */}
        {failedMissions.length > 0 && (
          <GlassPanel header="Failed Missions (Drift Indicators)">
            <div className="space-y-2">
              {failedMissions.slice(0, 5).map((m: any) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-2 rounded-lg border border-red-500/10 bg-red-500/[0.03]"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-sm text-white/80">
                      {m.mission_type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="text-xs text-white/40">
                    {new Date(m.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </GlassPanel>
        )}
      </div>

      {/* ═══ Section 4: Audit Appendix ═══ */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-purple-400">history</span>
          Audit Appendix
        </h2>
        <GlassPanel header="Recent AI Ledger Events">
          <div className="space-y-1">
            {ledgerEvents.length > 0 ? (
              ledgerEvents.map((evt: any) => (
                <div
                  key={evt.id}
                  className="flex items-center justify-between p-2 rounded border border-white/5 bg-white/[0.01] text-xs"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        evt.status === "ok"
                          ? "bg-emerald-500"
                          : evt.status === "working"
                            ? "bg-blue-500"
                            : "bg-amber-500"
                      }`}
                    />
                    <span className="text-white/70 font-mono truncate">{evt.event_key}</span>
                    <span className="text-white/40 truncate">{evt.ui_message}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                    <span className="text-white/30 font-mono">
                      {(evt.meta as any)?.correlationId?.slice(0, 12) ?? "—"}
                    </span>
                    <span className="text-white/30">
                      {new Date(evt.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-white/50">No AI events recorded yet</p>
            )}
          </div>
        </GlassPanel>
      </div>

      {/* ═══ Quick Links ═══ */}
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

      {/* ═══ Recent Decisions ═══ */}
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
