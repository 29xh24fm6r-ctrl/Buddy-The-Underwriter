import type { DealContext } from "@/lib/deals/contextTypes";
import StitchSurface from "@/stitch/StitchSurface";

export function StitchPanel({
  dealId,
  context,
}: {
  dealId: string;
  context: DealContext;
}) {
  return (
    <div className="h-full p-6">
      <StitchSurface
        surfaceKey="deal_command"
        dealId={dealId}
        title="Command"
        mode="panel"
      />
      <div className="sr-only">
        {context.borrower?.name ? `Deal: ${context.borrower.name}` : "Deal context loaded"}
      </div>
    </div>
  );
}
