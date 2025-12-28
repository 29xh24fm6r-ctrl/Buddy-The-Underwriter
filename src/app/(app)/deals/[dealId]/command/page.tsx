// src/app/(app)/deals/[dealId]/command/page.tsx
import { CommandShell } from "./CommandShell";
import { DealSmsTimeline } from "./DealSmsTimeline";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function DealCommandPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  if (!dealId) {
    return (
      <main className="min-h-screen p-10">
        <div className="mx-auto max-w-6xl text-red-600">
          Missing dealId — route params not found.
        </div>
      </main>
    );
  }

  return (
    <>
      <CommandShell dealId={dealId} />
      
      {/* SMS Timeline (floating overlay in bottom-right) */}
      <div className="fixed bottom-4 right-4 z-50 w-96 max-h-[60vh] overflow-auto">
        <Suspense fallback={
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-lg">
            <div className="text-sm text-neutral-500">Loading SMS activity...</div>
          </div>
        }>
          <DealSmsTimeline dealId={dealId} />
        </Suspense>
      </div>
    </>
  );
}
