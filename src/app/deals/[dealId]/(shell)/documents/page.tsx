export default async function DealDocumentsPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-lg font-semibold">Documents</div>
        <div className="text-sm text-muted-foreground">Release stub (mock) — wire to uploads next.</div>
      </div>

      <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4 text-sm">
        <div className="font-semibold">Request list</div>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>• Last 12 months bank statements</li>
          <li>• A/R aging report</li>
          <li>• Inventory report</li>
          <li>• Tax returns (2 years)</li>
        </ul>
        <div className="mt-3 text-xs text-muted-foreground">
          dealId: <span className="font-mono">{dealId}</span>
        </div>
      </div>
    </div>
  );
}
