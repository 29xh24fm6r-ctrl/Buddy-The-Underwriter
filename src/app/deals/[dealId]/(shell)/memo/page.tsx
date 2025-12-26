import StitchFrame from "@/components/stitch/StitchFrame";
import { getStitchExport } from "@/components/stitch/getStitchExport";

export default async function DealMemoWorkspace({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  const slugCandidates = ["memo", "credit-memo", "deal-memo", "command-center-latest"];

  const exportData = await getStitchExport(slugCandidates);

  if (!exportData) {
    return (
      <div className="space-y-2">
        <div className="text-lg font-semibold">Memo (fallback)</div>
        <div className="text-sm text-muted-foreground">
          No stitch export found. Add a stitch export and map it here.
        </div>
        <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4 text-sm">
          dealId: <span className="font-mono">{dealId}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-lg font-semibold">Credit Memo</div>
          <div className="text-sm text-muted-foreground">
            Stitch memo UI embedded; later we wire real evidence + generation.
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Export: <span className="font-mono">{exportData.slug}</span>
        </div>
      </div>

      <StitchFrame
        title={`Deal ${dealId} — Memo`}
        tailwindCdnSrc={exportData.tailwindCdnSrc}
        tailwindConfigJs={exportData.tailwindConfigJs}
        fontLinks={exportData.fontLinks}
        styles={exportData.styles}
        bodyHtml={exportData.bodyHtml}
        className="overflow-hidden rounded-xl border border-border-dark bg-[#0b0d10]"
      />
    </div>
  );
}
