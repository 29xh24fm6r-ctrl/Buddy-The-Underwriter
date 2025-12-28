/**
 * /examiner - Examiner Mode Home
 * 
 * Read-only view for regulators and examiners.
 * Provides searchable decisions, regulator ZIP downloads, minutes, attestations.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import Link from "next/link";

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
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Examiner Banner */}
      <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="font-semibold text-yellow-800">Examiner Mode</span>
        </div>
        <p className="text-sm text-yellow-700 mt-1">
          Read-only snapshot view for regulatory examination. No actions permitted.
        </p>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Examiner Dashboard</h1>
        <p className="text-sm text-gray-600 mt-1">
          Searchable decisions, attestations, and regulator-ready exports
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-sm text-gray-600 mb-1">Final Decisions</div>
          <div className="text-2xl font-bold text-blue-600">
            {finalDecisions?.length || 0}
          </div>
        </div>
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-sm text-gray-600 mb-1">Committee Decisions</div>
          <div className="text-2xl font-bold text-purple-600">
            {committeeCount || 0}
          </div>
        </div>
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-sm text-gray-600 mb-1">Total Attestations</div>
          <div className="text-2xl font-bold text-green-600">
            {attestationCount || 0}
          </div>
        </div>
      </div>

      {/* Final Decisions Table */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Final Decisions (Read-Only)</h2>
        {finalDecisions && finalDecisions.length > 0 ? (
          <div className="space-y-2">
            {finalDecisions.map((decision: any) => (
              <Link
                key={decision.id}
                href={`/deals/${decision.deal_id}/decision?snapshot=${decision.id}&examiner=true`}
                className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1">
                  <div className="font-medium text-sm">
                    {decision.deals?.name || `Deal ${decision.deal_id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(decision.created_at).toLocaleDateString()} • 
                    Hash: {decision.snapshot_hash?.slice(0, 12)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {decision.committee_required && (
                    <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                      Committee
                    </span>
                  )}
                  <span className={`text-xs px-2 py-1 rounded ${
                    decision.decision?.toLowerCase().includes("approve")
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}>
                    {decision.decision || "Unknown"}
                  </span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No final decisions available</p>
        )}
      </div>

      {/* Export Instructions */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Export Instructions</h2>
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-medium">Individual Decision Export</div>
            <div className="text-gray-600">
              Click any decision above to view details. Download regulator ZIP bundle from decision page.
            </div>
          </div>
          <div>
            <div className="font-medium">Verification</div>
            <div className="text-gray-600">
              All decisions include QR codes linking to public verification endpoint:
              <code className="ml-1 text-xs bg-gray-100 px-1 py-0.5 rounded">/api/verify/[hash]</code>
            </div>
          </div>
          <div>
            <div className="font-medium">Attestation Chain</div>
            <div className="text-gray-600">
              Each verified decision shows complete attestation chain with timestamps and signatory roles.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
