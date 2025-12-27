import { rebuildEvidenceCatalogAction } from "../../_actions/evidenceActions";
import { getCatalog } from "@/lib/evidence/evidenceStore";

export default async function DealDocumentsPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const catalog = await getCatalog(dealId);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Documents</div>
          <div className="text-sm text-muted-foreground">
            Release stub (mock) — wire to uploads next.
            {catalog.length > 0 && (
              <span className="ml-2">
                · Evidence Catalog: <span className="font-medium text-white">{catalog.length} items</span>
              </span>
            )}
          </div>
        </div>
        {catalog.length > 0 && (
          <form action={async () => { "use server"; await rebuildEvidenceCatalogAction(dealId); }}>
            <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
              Rebuild Catalog (AI)
            </button>
          </form>
        )}
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

      {catalog.length > 0 && (
        <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-semibold text-sm">Evidence Catalog Items</div>
            <div className="text-xs text-muted-foreground">{catalog.length} items curated by AI</div>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {catalog.slice(0, 20).map((item) => (
              <div key={item.id} className="rounded-lg border border-border-dark/50 bg-[#0a0c0f] p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{item.title}</div>
                  <span className="rounded px-1.5 py-0.5 text-xs bg-primary/20 text-primary">
                    {item.itemType}
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">{item.body}</div>
                {item.tags.length > 0 && (
                  <div className="mt-2 flex gap-1 flex-wrap">
                    {item.tags.map((tag, i) => (
                      <span key={i} className="rounded px-1.5 py-0.5 text-xs bg-border-dark text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

