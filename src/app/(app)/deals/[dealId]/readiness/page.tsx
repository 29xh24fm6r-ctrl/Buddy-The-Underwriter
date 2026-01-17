import { buildDealIntelligence } from "@/lib/dealIntelligence/buildDealIntelligence";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";

export const dynamic = "force-dynamic";

type Props = { params: { dealId: string } };

export default async function DealReadinessPage({ params }: Props) {
  const intelligence = await buildDealIntelligence(params.dealId);
  const readiness = intelligence.readiness;

  return (
    <div
      className="mx-auto w-full max-w-5xl px-6 py-8 space-y-6"
      data-testid="deal-readiness"
    >
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-neutral-900">Deal Readiness / SBA Certification</h1>
        <DealNameInlineEditor
          dealId={intelligence.deal.id}
          displayName={intelligence.deal.display_name ?? null}
          nickname={intelligence.deal.nickname ?? null}
          borrowerName={intelligence.deal.borrower_name}
          size="sm"
        />
        <div className="text-sm text-neutral-500">Deal {intelligence.deal.id}</div>
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-xs text-neutral-500">Readiness Score</div>
            <div className="text-4xl font-bold text-neutral-900">{readiness.score0to100}</div>
            <div className="text-sm font-semibold text-neutral-700">{readiness.label}</div>
          </div>
          <div className="flex-1 space-y-3">
            {([
              ["Documents", readiness.breakdown.documents],
              ["Financials", readiness.breakdown.financials],
              ["Legal", readiness.breakdown.legal],
              ["Collateral", readiness.breakdown.collateral],
            ] as const).map(([label, value]) => (
              <div key={label}>
                <div className="flex items-center justify-between text-sm text-neutral-600">
                  <span>{label}</span>
                  <span>{value}%</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-neutral-100">
                  <div
                    className="h-2 rounded-full bg-neutral-900 transition-all"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Why this score?</h2>
        <ul className="mt-2 space-y-1 text-sm text-neutral-700">
          {readiness.explainability.map((line) => (
            <li key={line}>• {line}</li>
          ))}
        </ul>
      </section>

      {intelligence.assumptions.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-amber-900">Assumptions / Missing Data</h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {intelligence.assumptions.map((assumption) => (
              <li key={assumption}>• {assumption}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
