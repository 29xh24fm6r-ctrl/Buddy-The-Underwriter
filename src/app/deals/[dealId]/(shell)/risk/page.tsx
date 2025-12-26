import Link from "next/link";

export default async function DealRiskPricingPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Risk & Pricing</div>
          <div className="text-sm text-muted-foreground">
            Release stub (mock). Next: plug in your real risk-based pricing model + evidence.
          </div>
        </div>

        <Link
          href={`/deals/${dealId}/memo`}
          className="rounded-lg border border-border-dark bg-[#0b0d10] px-3 py-1.5 text-sm hover:bg-[#121622]"
        >
          Continue to Memo →
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Risk grade (mock)">
          <div className="text-2xl font-semibold">B+</div>
          <div className="mt-1 text-sm text-muted-foreground">Drivers: cashflow volatility, collateral quality.</div>
        </Panel>

        <Panel title="Proposed pricing (mock)">
          <div className="text-2xl font-semibold">SOFR + 650</div>
          <div className="mt-1 text-sm text-muted-foreground">Floor: 7.50% • Orig: 1.50%</div>
        </Panel>

        <Panel title="Covenants (mock)">
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Min DSCR: 1.20x</li>
            <li>• Max leverage: 3.5x</li>
            <li>• Reporting: monthly</li>
          </ul>
        </Panel>
      </div>

      <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
        <div className="text-sm font-semibold">Explainability (placeholder)</div>
        <div className="mt-2 text-sm text-muted-foreground">
          This is where we'll render the "why" behind the risk grade and pricing (evidence links, model inputs,
          sensitivity).
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
