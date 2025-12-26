export default async function DealAuditPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-lg font-semibold">Audit</div>
        <div className="text-sm text-muted-foreground">Release stub — later wire to audit/compliance ledger.</div>
      </div>

      <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4 text-sm">
        <div className="font-semibold">Recent events (mock)</div>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>• Risk grade set to B+ (user: you)</li>
          <li>• Docs requested: bank statements (user: you)</li>
          <li>• Memo generated (system)</li>
        </ul>
        <div className="mt-3 text-xs text-muted-foreground">
          dealId: <span className="font-mono">{dealId}</span>
        </div>
      </div>
    </div>
  );
}
