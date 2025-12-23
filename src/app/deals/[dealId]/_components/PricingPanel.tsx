export function PricingPanel({ ctx }: { dealId: string; ctx: any }) {
  // We render pricing as JSON for now because your pricing_* tables exist
  // but we haven't mapped required columns/constraints yet.
  // Next step: "quote pricing from snapshot" -> inserts pricing_quotes.

  const pricingPolicies = ctx?.pricing_policies ?? null;
  const pricingQuotes = ctx?.pricing_quotes ?? null;

  return (
    <div id="pricing" className="rounded-2xl border border-white/10 bg-black/40 p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-white">Pricing</div>
          <div className="text-sm text-white/60">Risk-based pricing will live here (panel first, page later)</div>
        </div>

        <button
          onClick={async () => {
            // Example call - adjust based on your actual pricing requirements
            const res = await fetch(`/api/deals/${ctx.deal_id}/pricing/quote`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                requestedAmount: 500000,
                termMonths: 60,
                riskRating: 5,
                collateralStrength: "moderate",
              }),
            });
            if (!res.ok) {
              const err = await res.json();
              alert(`Pricing failed: ${err.error}`);
            } else {
              window.location.reload();
            }
          }}
          className="rounded-full bg-sky-500/20 px-3 py-2 text-sm text-sky-200 hover:bg-sky-500/25"
        >
          Quote Pricing
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <JsonBox title="Pricing Policies (placeholder)" data={pricingPolicies} />
        <JsonBox title="Pricing Quotes (placeholder)" data={pricingQuotes} />
      </div>
    </div>
  );
}

function JsonBox({ title, data }: { title: string; data: any }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="text-sm font-medium text-white">{title}</div>
      <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-white/70">
        {data ? JSON.stringify(data, null, 2) : "null"}
      </pre>
    </div>
  );
}
