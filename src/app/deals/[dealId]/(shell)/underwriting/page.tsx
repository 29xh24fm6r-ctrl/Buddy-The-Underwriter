import StitchFrame from "@/components/stitch/StitchFrame";
import { getStitchExport } from "@/components/stitch/getStitchExport";

export default async function DealUnderwritingWorkspace({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  // Pick the best available stitch export slug.
  // You can rename later — this is release-safe.
  const slugCandidates = [
    "deal-detail-workspace",
    "underwriter-workspace",
    "command-center-latest",
    "deals",
  ];

  const exportData = await getStitchExport(slugCandidates);

  if (!exportData) {
    return (
      <div className="space-y-2">
        <div className="text-lg font-semibold">Underwriting (fallback)</div>
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
          <div className="text-lg font-semibold">Underwriting</div>
          <div className="text-sm text-muted-foreground">
            Stitch workspace embedded inside bounded container (proportions locked).
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Export: <span className="font-mono">{exportData.slug}</span>
        </div>
      </div>

      <StitchFrame
        title={`Deal ${dealId} — Underwriting`}
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
