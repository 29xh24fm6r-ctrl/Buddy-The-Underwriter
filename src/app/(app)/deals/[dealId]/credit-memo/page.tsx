import "server-only";

/**
 * /deals/[dealId]/credit-memo
 *
 * Credit Memo rendered inside the deal shell (with full deal nav bar).
 * This is the canonical entry point — the standalone /credit-memo/[dealId]/canonical
 * route remains for backwards compatibility and print view.
 */

import Link from "next/link";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";
import CanonicalMemoTemplate from "@/components/creditMemo/CanonicalMemoTemplate";
import SpreadsAppendix from "@/components/creditMemo/SpreadsAppendix";
import ExportCanonicalMemoPdfButton from "@/components/creditMemo/ExportCanonicalMemoPdfButton";
import GenerateNarrativesButton from "@/components/creditMemo/GenerateNarrativesButton";
import RunResearchButton from "@/components/creditMemo/RunResearchButton";
import RegenerateMemoButton from "@/components/creditMemo/RegenerateMemoButton";
import MemoCompletionWizard from "@/components/creditMemo/MemoCompletionWizard";
import BlockedMemoRecoveryPanel from "@/components/creditMemo/BlockedMemoRecoveryPanel";
import MemoDataEntryCard from "@/components/creditMemo/MemoDataEntryCard";
import MemoInputsBody from "@/components/creditMemo/inputs/MemoInputsBody";
import MemoInputsRedirectBanner from "@/components/creditMemo/MemoInputsRedirectBanner";
import TranscriptUploadPanel from "@/components/deals/TranscriptUploadPanel";
import BankerVoicePanel from "@/components/deals/BankerVoicePanel";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildSbaForm1919 } from "@/lib/sba/forms/build1919";
import { buildSbaForm1920 } from "@/lib/sba/forms/build1920";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function DealCreditMemoPage(props: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await props.params;
  await requireDealAccess(dealId);
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;

  const sb = supabaseAdmin();

  // ── Memo Input Completeness redirect guard ────────────────────────────
  // If no banker_submitted snapshot exists yet AND memo inputs are not
  // ready, route the banker to /memo-inputs instead of rendering a memo
  // they cannot submit. Once submitted, the banker can return here to
  // view the frozen snapshot.
  const submittedRes = await (sb as any)
    .from("credit_memo_snapshots")
    .select("id", { head: true, count: "exact" })
    .eq("deal_id", dealId)
    .in("status", [
      "banker_submitted",
      "underwriter_review",
      "returned",
      "finalized",
    ])
    .limit(1);
  const hasSubmittedSnapshot = (submittedRes?.count ?? 0) > 0;

  if (!hasSubmittedSnapshot) {
    const inputResult = await buildMemoInputPackage({
      dealId,
      runReconciliation: false,
    });
    if (inputResult.ok && !inputResult.package.readiness.ready) {
      // SPEC-13: replace silent redirect() with a visible banner that
      // the banker can read, sitting above an inline copy of the
      // memo-inputs surface. The banner soft-redirects after 1.5s
      // (client-side router push); the banker is never left wondering
      // why the URL changed.
      const pkg = inputResult.package;
      const missingCount = pkg.readiness.blockers.length;
      return (
        <div className="bg-gray-50 min-h-screen">
          <div className="mx-auto max-w-[1100px] p-8 space-y-6">
            <MemoInputsRedirectBanner
              dealId={dealId}
              missingCount={missingCount}
            />
            <header>
              <h1 className="text-xl font-semibold text-gray-900">Memo Inputs</h1>
              <p className="text-sm text-gray-600">
                Complete the inputs below before this memo can finalize.
              </p>
            </header>
            <MemoInputsBody dealId={dealId} pkg={pkg} />
          </div>
        </div>
      );
    }
  }

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
    ? evaluateSbaEligibility({
        snapshot,
        borrowerEntityType: (deal as any)?.entity_type ?? null,
        useOfProceeds: Array.isArray((loanRequest as any)?.use_of_proceeds)
          ? (loanRequest as any).use_of_proceeds
          : null,
        dealType: (deal as any)?.deal_type ?? null,
        loanProductType: (loanRequest as any)?.product_type ?? null,
      })
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
  if (res.ok) {
    const { data: cachedNarrative } = await sb
      .from("canonical_memo_narratives")
      .select("narratives")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cachedNarrative?.narratives) {
      const n = cachedNarrative.narratives as any;
      if (n.executive_summary) res.memo.executive_summary.narrative = n.executive_summary;
      if (n.income_analysis) res.memo.financial_analysis.income_analysis = n.income_analysis;
      if (n.property_description) res.memo.collateral.property_description = n.property_description;
      if (n.borrower_background) res.memo.borrower_sponsor.background = n.borrower_background;
      if (n.borrower_experience) res.memo.borrower_sponsor.experience = n.borrower_experience;
      if (n.guarantor_strength) res.memo.borrower_sponsor.guarantor_strength = n.guarantor_strength;
    }
  }

  if (!res.ok) {
    return (
      <div className="bg-white min-h-screen p-8">
        <div className="mx-auto max-w-[980px]">
          <h1 className="text-xl font-semibold text-[#111418]">Credit Memo</h1>
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm font-medium text-rose-800">Unable to build memo</p>
            <p className="mt-1 text-sm text-rose-700">{res.error}</p>
            <div className="mt-3 flex items-center gap-2">
              <RunResearchButton dealId={dealId} />
              <GenerateNarrativesButton dealId={dealId} />
            </div>
          </div>
        </div>
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
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/credit-memo/${dealId}/canonical/print`}
              className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50"
            >
              Print View
            </Link>
            <MemoCompletionWizard
              dealId={dealId}
              principals={res.memo.management_qualifications.principals.map(p => ({
                id: p.id,
                name: p.name,
              }))}
              missingMetrics={res.memo.meta.readiness.missing_metrics}
            />
            <RunResearchButton dealId={dealId} />
            <GenerateNarrativesButton dealId={dealId} />
            {/* Regenerates full memo data (picks up new spreads/facts) */}
            <RegenerateMemoButton dealId={dealId} />
            <ExportCanonicalMemoPdfButton dealId={dealId} />
          </div>
        </div>

        <BlockedMemoRecoveryPanel dealId={dealId} />

        <div className="mb-6">
          <TranscriptUploadPanel dealId={dealId} />
        </div>

        <div className="mb-6">
          <BankerVoicePanel dealId={dealId} />
        </div>

        <MemoDataEntryCard
          dealId={dealId}
          readiness={res.memo.meta.readiness}
          dataCoverage={res.memo.meta.data_completeness}
          hints={{
            bankLoanTotal: res.memo.key_metrics.loan_amount.value,
            cashFlowAvailable: res.memo.financial_analysis.cash_flow_available.value,
            annualDebtService: res.memo.financial_analysis.debt_service.value,
          }}
        />
        <CanonicalMemoTemplate memo={res.memo} />

        <SpreadsAppendix dealId={dealId} bankId={bankId} />

        {sba1919 || sba1920 ? (
          <details className="mt-6">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800">
              SBA Forms (1919 / 1920)
            </summary>
            <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {sba1919 ? (
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="text-sm font-semibold text-gray-800">Form 1919</div>
                    <div className="mt-1 text-xs text-gray-500">Missing fields: {sba1919.missing.length}</div>
                    {sba1919.missing.length ? (
                      <div className="mt-2 text-xs text-gray-500">{sba1919.missing.join(", ")}</div>
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
                      <div className="mt-2 text-xs text-gray-500">{sba1920.missing.join(", ")}</div>
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
          </details>
        ) : null}
      </div>
    </div>
  );
}
