// src/app/deals/[dealId]/interview/page.tsx
import DealInterviewPanel from "@/components/deals/interview/DealInterviewPanel";

export default async function DealInterviewPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Borrower Interview</h1>
        <p className="text-sm text-muted-foreground">
          Capture provable facts via conversation. Facts only exist after explicit confirmation.
        </p>
      </div>

      <DealInterviewPanel dealId={dealId} />
    </div>
  );
}
