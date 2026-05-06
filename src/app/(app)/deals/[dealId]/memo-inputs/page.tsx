import "server-only";

/**
 * /deals/[dealId]/memo-inputs
 *
 * Memo Inputs control center — pre-memo gate that proves Buddy has
 * everything required for a Florida Armory-grade credit memo before the
 * banker submits it.
 */

import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";

import BorrowerStoryForm from "@/components/creditMemo/inputs/BorrowerStoryForm";
import ManagementProfilesForm from "@/components/creditMemo/inputs/ManagementProfilesForm";
import CollateralItemsTable from "@/components/creditMemo/inputs/CollateralItemsTable";
import FactConflictsPanel from "@/components/creditMemo/inputs/FactConflictsPanel";
import MemoInputReadinessPanel from "@/components/creditMemo/inputs/MemoInputReadinessPanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function MemoInputsPage(props: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await props.params;
  await requireDealAccess(dealId);

  const result = await buildMemoInputPackage({
    dealId,
    runReconciliation: true,
  });

  if (!result.ok) {
    return (
      <div className="bg-white min-h-screen p-8">
        <div className="mx-auto max-w-[980px]">
          <h1 className="text-xl font-semibold text-gray-900">Memo Inputs</h1>
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Unable to load memo input package: {result.error ?? result.reason}
          </div>
        </div>
      </div>
    );
  }

  const pkg = result.package;

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="mx-auto max-w-[1100px] p-8 space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-gray-900">Memo Inputs</h1>
          <p className="text-sm text-gray-600">
            Pre-memo control center. The submission gate enforces every
            section here before a credit memo can be sent to underwriting.
          </p>
        </header>

        <MemoInputReadinessPanel readiness={pkg.readiness} />

        <BorrowerStoryForm dealId={dealId} initial={pkg.borrower_story} />

        <ManagementProfilesForm dealId={dealId} initial={pkg.management_profiles} />

        <CollateralItemsTable dealId={dealId} initial={pkg.collateral_items} />

        <FinancialFactsCard facts={pkg.financial_facts} />

        <ResearchCard research={pkg.research} />

        <FactConflictsPanel dealId={dealId} initial={pkg.conflicts} />
      </div>
    </div>
  );
}

function FinancialFactsCard({
  facts,
}: {
  facts: { dscr: number | null; annualDebtService: number | null; globalCashFlow: number | null; loanAmount: number | null };
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">Financial Facts</h2>
      <p className="text-xs text-gray-500">Computed by Buddy from extracted documents.</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Stat label="DSCR" value={fmt(facts.dscr, 2)} />
        <Stat label="Annual debt service" value={fmtMoney(facts.annualDebtService)} />
        <Stat label="Global cash flow" value={fmtMoney(facts.globalCashFlow)} />
        <Stat label="Loan amount" value={fmtMoney(facts.loanAmount)} />
      </dl>
    </section>
  );
}

function ResearchCard({
  research,
}: {
  research: { gate_passed: boolean; trust_grade: string | null; quality_score: number | null } | null;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">Research</h2>
      {!research ? (
        <p className="mt-1 text-sm text-gray-700">No research mission has been run.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <Stat label="Gate passed" value={research.gate_passed ? "yes" : "no"} />
          <Stat label="Trust grade" value={research.trust_grade ?? "—"} />
          <Stat label="Quality score" value={fmt(research.quality_score, 2)} />
        </dl>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 p-2">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function fmt(v: number | null, digits: number): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtMoney(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `$${Math.round(v).toLocaleString()}`;
}
