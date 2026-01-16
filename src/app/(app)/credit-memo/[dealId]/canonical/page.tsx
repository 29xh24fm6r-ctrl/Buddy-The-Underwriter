import "server-only";

import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import CanonicalMemoTemplate from "@/components/creditMemo/CanonicalMemoTemplate";
import ExportCanonicalMemoPdfButton from "@/components/creditMemo/ExportCanonicalMemoPdfButton";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CanonicalCreditMemoPage(props: {
  params: Promise<{ dealId: string }>;
}) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await props.params;
  const bankId = await getCurrentBankId();

  const sb = supabaseAdmin();
  const { data: decision } = await sb
    .from("financial_snapshot_decisions")
    .select("narrative_json, sba_json, created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const res = await buildCanonicalCreditMemo({ dealId, bankId });
  if (!res.ok) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Credit Memo (Canonical)</h1>
        <p className="mt-2 text-sm text-white/70">Unable to build memo: {res.error}</p>
      </div>
    );
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="mx-auto max-w-[980px] p-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#111418]">Credit Memo</h1>
            <div className="text-xs text-gray-500">Canonical v1 (deterministic)</div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/credit-memo/${dealId}/canonical/print`}
              className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50"
            >
              Print View
            </Link>
            <ExportCanonicalMemoPdfButton dealId={dealId} />
          </div>
        </div>

        {decision?.narrative_json ? (
          <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Underwriting Narrative</div>
            <div className="mt-2 text-sm text-gray-800 whitespace-pre-line">
              {decision.narrative_json.executiveSummary ?? "Narrative unavailable."}
            </div>
            {decision.narrative_json.cashFlowAnalysis ? (
              <div className="mt-3 text-sm text-gray-700 whitespace-pre-line">
                {decision.narrative_json.cashFlowAnalysis}
              </div>
            ) : null}
            {Array.isArray(decision.narrative_json.risks) && decision.narrative_json.risks.length ? (
              <div className="mt-3">
                <div className="text-xs text-gray-500">Risks</div>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                  {decision.narrative_json.risks.map((r: string, idx: number) => (
                    <li key={`risk-${idx}`}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {Array.isArray(decision.narrative_json.mitigants) && decision.narrative_json.mitigants.length ? (
              <div className="mt-3">
                <div className="text-xs text-gray-500">Mitigants</div>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                  {decision.narrative_json.mitigants.map((m: string, idx: number) => (
                    <li key={`mitigant-${idx}`}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {decision.narrative_json.recommendation ? (
              <div className="mt-3 text-sm font-semibold text-gray-800">
                Recommendation: {decision.narrative_json.recommendation}
              </div>
            ) : null}
          </div>
        ) : null}

        <CanonicalMemoTemplate memo={res.memo} />
      </div>
    </div>
  );
}
