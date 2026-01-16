import { buildDealIntelligence, formatConditionsEmail } from "@/lib/dealIntelligence/buildDealIntelligence";
import { CopyToClipboardButton } from "@/components/deals/DealOutputActions";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";

export const dynamic = "force-dynamic";

type Props = { params: { dealId: string } };

export default async function ConditionsSummaryPage({ params }: Props) {
  const intelligence = await buildDealIntelligence(params.dealId);
  const emailText = formatConditionsEmail(intelligence);

  const requiredMissing = intelligence.conditions.missingDocs.filter((d) => d.required);
  const optionalMissing = intelligence.conditions.missingDocs.filter((d) => !d.required);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-neutral-900">Conditions & Missing Docs</h1>
          <DealNameInlineEditor
            dealId={intelligence.deal.id}
            displayName={intelligence.deal.display_name ?? null}
            nickname={intelligence.deal.nickname ?? null}
            borrowerName={intelligence.deal.borrower_name}
            size="sm"
          />
          <div className="text-sm text-neutral-500">Deal {intelligence.deal.id}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CopyToClipboardButton label="Copy to Email" text={emailText} />
          <a
            href={`/api/deals/${params.dealId}/conditions/pdf`}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-50"
          >
            Export PDF
          </a>
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-neutral-500">Required missing</div>
          <div className="text-2xl font-semibold text-neutral-900">{requiredMissing.length}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-neutral-500">Optional missing</div>
          <div className="text-2xl font-semibold text-neutral-900">{optionalMissing.length}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-neutral-500">Open conditions</div>
          <div className="text-2xl font-semibold text-neutral-900">{intelligence.conditions.open.length}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-neutral-500">Last activity</div>
          <div className="text-sm font-semibold text-neutral-900">
            {intelligence.activity[0]?.at ? new Date(intelligence.activity[0].at).toLocaleString() : "Unknown"}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Missing Required Documents</h2>
        <ul className="mt-2 space-y-1 text-sm text-neutral-700">
          {requiredMissing.length ? requiredMissing.map((item) => (
            <li key={item.key}>• {item.label}</li>
          )) : (
            <li>• None</li>
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Missing Optional Documents</h2>
        <ul className="mt-2 space-y-1 text-sm text-neutral-700">
          {optionalMissing.length ? optionalMissing.map((item) => (
            <li key={item.key}>• {item.label}</li>
          )) : (
            <li>• None</li>
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Open Conditions</h2>
        <ul className="mt-2 space-y-1 text-sm text-neutral-700">
          {intelligence.conditions.open.length ? intelligence.conditions.open.map((item) => (
            <li key={item.key}>• {item.label} ({item.status})</li>
          )) : (
            <li>• None</li>
          )}
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
