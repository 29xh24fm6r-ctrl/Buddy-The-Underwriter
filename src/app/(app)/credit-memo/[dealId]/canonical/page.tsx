import "server-only";

import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import CanonicalMemoTemplate from "@/components/creditMemo/CanonicalMemoTemplate";
import ExportCanonicalMemoPdfButton from "@/components/creditMemo/ExportCanonicalMemoPdfButton";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildSbaForm1919 } from "@/lib/sba/forms/build1919";
import { buildSbaForm1920 } from "@/lib/sba/forms/build1920";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CanonicalCreditMemoPage(props: {
  params: Promise<{ dealId: string }>;
}) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await props.params;
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;

  const sb = supabaseAdmin();
  const { data: decision } = await sb
    .from("financial_snapshot_decisions")
    .select("narrative_json, sba_json, created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [{ data: snapshotRow }, { data: deal }, { data: loanRequest }] = await Promise.all([
    sb
      .from("financial_snapshots")
      .select("snapshot_json")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("deals")
      .select("*")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle(),
    sb
      .from("deal_loan_requests")
      .select("requested_amount, use_of_proceeds, product_type")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const snapshot = snapshotRow?.snapshot_json as DealFinancialSnapshotV1 | undefined;
  const eligibility = snapshot
    ? (decision?.sba_json
        ? (decision.sba_json as any)
        : evaluateSbaEligibility({
            snapshot,
            borrowerEntityType: (deal as any)?.entity_type ?? null,
            useOfProceeds: Array.isArray((loanRequest as any)?.use_of_proceeds)
              ? (loanRequest as any).use_of_proceeds
              : null,
            dealType: (deal as any)?.deal_type ?? null,
            loanProductType: (loanRequest as any)?.product_type ?? null,
          }))
    : null;

  const sba1919 = snapshot
    ? buildSbaForm1919({
        snapshot,
        borrowerName: (deal as any)?.borrower_name ?? (deal as any)?.name ?? null,
        entityType: (deal as any)?.entity_type ?? null,
        loanAmount: (loanRequest as any)?.requested_amount ?? null,
        useOfProceeds: Array.isArray((loanRequest as any)?.use_of_proceeds)
          ? (loanRequest as any).use_of_proceeds
          : null,
        eligibility: eligibility as any,
      })
    : null;

  const sba1920 = snapshot
    ? buildSbaForm1920({
        snapshot,
        borrowerName: (deal as any)?.borrower_name ?? (deal as any)?.name ?? null,
        loanAmount: (loanRequest as any)?.requested_amount ?? null,
      })
    : null;

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

        {sba1919 || sba1920 ? (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">SBA Forms</div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {sba1919 ? (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="text-sm font-semibold text-gray-800">Form 1919</div>
                  <div className="mt-1 text-xs text-gray-500">Missing fields: {sba1919.missing.length}</div>
                  {sba1919.missing.length ? (
                    <div className="mt-2 text-xs text-gray-500">
                      {sba1919.missing.join(", ")}
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      href={`/api/deals/${dealId}/sba/forms/1919`}
                      className="inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                    >
                      Export JSON
                    </Link>
                  </div>
                </div>
              ) : null}
              {sba1920 ? (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="text-sm font-semibold text-gray-800">Form 1920</div>
                  <div className="mt-1 text-xs text-gray-500">Missing fields: {sba1920.missing.length}</div>
                  {sba1920.missing.length ? (
                    <div className="mt-2 text-xs text-gray-500">
                      {sba1920.missing.join(", ")}
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      href={`/api/deals/${dealId}/sba/forms/1920`}
                      className="inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                    >
                      Export JSON
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <CanonicalMemoTemplate memo={res.memo} />
      </div>
    </div>
  );
}
