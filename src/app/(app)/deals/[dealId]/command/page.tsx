// src/app/(app)/deals/[dealId]/command/page.tsx
import { CommandShell } from "./CommandShell";

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

  return <CommandShell dealId={dealId} />;
}
