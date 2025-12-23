export function IntelPanel({ ctx }: { dealId: string; ctx: any }) {
  const extractions = (ctx?.borrower_upload_extractions ?? []) as any[];

  const bank = extractions.find((x) => x.kind === "BANK_STATEMENTS");
  const fin = extractions.find((x) => x.kind === "FINANCIAL_STATEMENTS");

  const bankFeesTotal = bank?.fields?.bankFees?.totalFees ?? null;
  const bankProducts = bank?.fields?.bankProducts?.detected?.length ?? null;

  const periods = fin?.fields?.periods ?? null;
  const finKind = fin?.fields?.statementKind ?? null;

  return (
    <div id="intel" className="rounded-2xl border border-white/10 bg-black/40 p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-white">AI Intel</div>
          <div className="text-sm text-white/60">Bank fee burden + financial statement spread</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card label="Bank Fees (Total)" value={bankFeesTotal !== null ? `$${bankFeesTotal}` : "—"} />
        <Card label="Bank Products Detected" value={bankProducts ?? "—"} />
        <Card label="Financial Periods" value={periods ? periods.join(", ") : "—"} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <JsonBox title="Latest Bank Extraction" data={bank ?? null} />
        <JsonBox title={`Latest Financial Extraction (${finKind ?? "—"})`} data={fin ?? null} />
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="text-sm text-white/60">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{String(value)}</div>
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
