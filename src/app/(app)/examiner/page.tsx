/**
 * /examiner - Examiner Mode Home
 *
 * Read-only view for regulators and examiners.
 * Provides searchable decisions, regulator ZIP downloads, minutes, attestations.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import Link from "next/link";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
  GlassStatCard,
  GlassInfoBox,
} from "@/components/layout";

export default async function ExaminerPage() {
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch final decisions
  const { data: finalDecisions } = await sb
    .from("decision_snapshots")
    .select("*, deals(name)")
    .eq("bank_id", bankId)
    .eq("status", "final")
    .order("created_at", { ascending: false })
    .limit(20);

  // Count committee decisions
  const { count: committeeCount } = await sb
    .from("decision_snapshots")
    .select("*", { count: "exact", head: true })
    .eq("bank_id", bankId)
    .eq("committee_required", true)
    .eq("status", "final");

  // Count attestations
  const { count: attestationCount } = await sb
    .from("decision_attestations")
    .select("*", { count: "exact", head: true })
    .eq("bank_id", bankId);

  return (
    <GlassShell>
      {/* Examiner Banner */}
      <GlassInfoBox icon="warning" title="Examiner Mode" variant="warning" className="mb-6">
        Read-only snapshot view for regulatory examination. No actions permitted.
      </GlassInfoBox>

      <GlassPageHeader
        title="Examiner Dashboard"
        subtitle="Searchable decisions, attestations, and regulator-ready exports"
      />

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <GlassStatCard label="Final Decisions" value={String(finalDecisions?.length || 0)} />
        <GlassStatCard label="Committee Decisions" value={String(committeeCount || 0)} />
        <GlassStatCard label="Total Attestations" value={String(attestationCount || 0)} />
      </div>

      {/* Final Decisions Table */}
      <GlassPanel header="Final Decisions (Read-Only)" className="mb-6">
        {finalDecisions && finalDecisions.length > 0 ? (
          <div className="space-y-2">
            {finalDecisions.map((decision: any) => (
              <Link
                key={decision.id}
                href={`/deals/${decision.deal_id}/decision?snapshot=${decision.id}&examiner=true`}
                className="flex items-center justify-between p-3 border border-white/10 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              >
                <div className="flex-1">
                  <div className="font-medium text-sm text-white">
                    {decision.deals?.name || `Deal ${decision.deal_id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    {new Date(decision.created_at).toLocaleDateString()} • Hash:{" "}
                    {decision.snapshot_hash?.slice(0, 12)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {decision.committee_required && (
                    <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-1 rounded border border-purple-500/30">
                      Committee
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-1 rounded border ${
                      decision.decision?.toLowerCase().includes("approve")
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        : "bg-red-500/20 text-red-300 border-red-500/30"
                    }`}
                  >
                    {decision.decision || "Unknown"}
                  </span>
                  <span className="material-symbols-outlined text-white/40 text-lg">
                    chevron_right
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/50">No final decisions available</p>
        )}
      </GlassPanel>

      {/* Export Instructions */}
      <GlassPanel header="Export Instructions">
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-medium text-white">Individual Decision Export</div>
            <div className="text-white/60">
              Click any decision above to view details. Download regulator ZIP bundle from
              decision page.
            </div>
          </div>
          <div>
            <div className="font-medium text-white">Verification</div>
            <div className="text-white/60">
              All decisions include QR codes linking to public verification endpoint:
              <code className="ml-1 text-xs bg-white/10 text-white/80 px-1 py-0.5 rounded">
                /api/verify/[hash]
              </code>
            </div>
          </div>
          <div>
            <div className="font-medium text-white">Attestation Chain</div>
            <div className="text-white/60">
              Each verified decision shows complete attestation chain with timestamps and
              signatory roles.
            </div>
          </div>
        </div>
      </GlassPanel>
    </GlassShell>
  );
}
