import { buildDealIntelligence, formatCreditMemoMarkdown } from "@/lib/dealIntelligence/buildDealIntelligence";
import { CopyToClipboardButton } from "@/components/deals/DealOutputActions";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";
import Link from "next/link";
import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";

export const dynamic = "force-dynamic";

type Props = {
  params: { dealId: string };
};

export default async function CreditMemoDraftPage({ params }: Props) {
  const verify = await verifyUnderwrite({ dealId: params.dealId, actor: "banker" });
  if (!verify.ok) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h1 className="text-2xl font-bold text-neutral-900">Credit Memo Draft</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Underwriting is not available until intake is complete.
          </p>
          <div className="mt-2 text-xs text-neutral-500">
            Next action: {verify.recommendedNextAction}
          </div>
          {verify.diagnostics?.missing?.length ? (
            <div className="mt-1 text-xs text-neutral-500">
              Missing: {verify.diagnostics.missing.join(", ")}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/deals/${params.dealId}`}
              className="inline-flex items-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
            >
              Complete Intake
            </Link>
            <Link
              href="/deals"
              className="inline-flex items-center rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-50"
            >
              Back to Deals
            </Link>
          </div>
        </div>
      </div>
    );
  }

  let intelligence: Awaited<ReturnType<typeof buildDealIntelligence>> | null = null;
  let errorCode: string | null = null;

  try {
    intelligence = await buildDealIntelligence(params.dealId);
  } catch (e: any) {
    errorCode = String(e?.message ?? "unknown_error");
  }

  if (!intelligence) {
    const dealId = params.dealId;
    const unauthorized = errorCode?.includes("unauthorized") || errorCode?.includes("tenant_mismatch");
    const notFound = errorCode?.includes("deal_not_found");

    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h1 className="text-2xl font-bold text-neutral-900">Credit Memo Draft</h1>
          <p className="mt-2 text-sm text-neutral-600">
            {unauthorized
              ? "You don’t have access to this deal."
              : notFound
              ? "Deal not found."
              : "Credit memo draft isn’t ready yet."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/deals/${dealId}/cockpit`}
              className="inline-flex items-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
            >
              Go to Deal Cockpit
            </Link>
            <Link
              href="/deals"
              className="inline-flex items-center rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-50"
            >
              Back to Deals
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const markdown = formatCreditMemoMarkdown(intelligence);
  const memo = intelligence.memoDraft;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="text-xs text-neutral-500">AI Draft — v1</div>
          <h1 className="text-2xl font-bold text-neutral-900">Credit Memo Draft</h1>
          <DealNameInlineEditor
            dealId={intelligence.deal.id}
            displayName={intelligence.deal.display_name ?? null}
            nickname={intelligence.deal.nickname ?? null}
            borrowerName={intelligence.deal.borrower_name ?? null}
            size="sm"
          />
          <div className="text-sm text-neutral-500">Deal {intelligence.deal.id}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CopyToClipboardButton label="Copy as Markdown" text={markdown} />
          <a
            href={`/api/deals/${params.dealId}/credit-memo/pdf`}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-50"
          >
            Export PDF
          </a>
        </div>
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Executive Summary</h2>
        <p className="mt-2 text-sm text-neutral-700">{memo.executiveSummary}</p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Borrower Overview</h2>
          <p className="mt-2 text-sm text-neutral-700">{memo.borrowerOverview}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Loan Request</h2>
          <p className="mt-2 text-sm text-neutral-700">{memo.loanRequest}</p>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Collateral Summary</h2>
          <p className="mt-2 text-sm text-neutral-700">{memo.collateralSummary}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Document / Checklist Status</h2>
          <p className="mt-2 text-sm text-neutral-700">{memo.documentChecklistStatus}</p>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Risk Factors</h2>
          <ul className="mt-2 space-y-1 text-sm text-neutral-700">
            {memo.riskFactors.length ? memo.riskFactors.map((risk) => (
              <li key={risk}>• {risk}</li>
            )) : (
              <li>• None identified</li>
            )}
          </ul>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Open Items / Conditions</h2>
          <ul className="mt-2 space-y-1 text-sm text-neutral-700">
            {memo.openItems.length ? memo.openItems.map((item) => (
              <li key={item}>• {item}</li>
            )) : (
              <li>• None</li>
            )}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Recent Activity</h2>
        <ul className="mt-2 space-y-1 text-sm text-neutral-700">
          {memo.recentActivity.length ? memo.recentActivity.map((activity) => (
            <li key={activity}>• {activity}</li>
          )) : (
            <li>• None</li>
          )}
        </ul>
      </section>

      {memo.assumptions.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-amber-900">Assumptions / Missing Data</h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {memo.assumptions.map((assumption) => (
              <li key={assumption}>• {assumption}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
