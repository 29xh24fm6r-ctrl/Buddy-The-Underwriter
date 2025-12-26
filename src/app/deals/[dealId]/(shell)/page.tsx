import Link from "next/link";

export default async function DealCommandCenterPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Deal Command Center</div>
          <div className="mt-1 text-sm text-muted-foreground">
            One place to run the deal. This is the release-ready hub for navigation + actions.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            className="rounded-lg border border-border-dark bg-[#0b0d10] px-3 py-1.5 text-sm hover:bg-[#121622]"
            href={`/deals/${dealId}/underwriting`}
          >
            Go to Underwriting
          </Link>
          <Link
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            href={`/deals/${dealId}/risk`}
          >
            Risk & Pricing
          </Link>
        </div>
      </div>

      {/* Polished end-to-end flow start: summary → docs → risk → memo */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4 lg:col-span-2">
          <div className="text-sm font-semibold">Today's priorities</div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>• Review borrower financials (mock)</li>
            <li>• Validate collateral + covenants (mock)</li>
            <li>• Set preliminary risk grade and price (stubbed page)</li>
            <li>• Generate memo and route for approval (mock)</li>
          </ul>
        </div>

        <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
          <div className="text-sm font-semibold">Deal snapshot</div>
          <div className="mt-3 space-y-2 text-sm">
            <Row k="Borrower" v="Acme Logistics LLC" />
            <Row k="Request" v="$2,500,000" />
            <Row k="Term" v="24 months" />
            <Row k="Collateral" v="A/R + Inventory" />
            <Row k="Stage" v="Underwriting" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Underwriting workspace"
          body="Work through checks, exceptions, and required conditions."
          href={`/deals/${dealId}/underwriting`}
          cta="Open"
        />
        <Card
          title="Documents"
          body="Review uploads, request missing items, and track status."
          href={`/deals/${dealId}/documents`}
          cta="Open"
        />
        <Card
          title="Memo"
          body="Generate and edit the credit memo from collected evidence."
          href={`/deals/${dealId}/memo`}
          cta="Open"
        />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-muted-foreground">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}

function Card({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-sm text-muted-foreground">{body}</div>
      <div className="mt-3">
        <Link
          href={href}
          className="inline-flex items-center gap-2 rounded-lg border border-border-dark bg-[#0f1115] px-3 py-1.5 text-sm hover:bg-[#121622]"
        >
          {cta}
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </Link>
      </div>
    </div>
  );
}
