// src/app/(app)/deals/[dealId]/committee/page.tsx
import { CommitteeView } from "./CommitteeView";

export const dynamic = "force-dynamic";

export default async function CommitteePage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams?: Promise<{ snapshotId?: string }>;
}) {
  const { dealId } = await params;
  const searchParamsResolved = searchParams ? await searchParams : {};
  const snapshotId = searchParamsResolved?.snapshotId;

  if (!dealId) {
    return (
      <main className="min-h-screen p-10">
        <div className="mx-auto max-w-6xl text-red-600">
          Missing dealId — route params not found.
        </div>
      </main>
    );
  }

  return <CommitteeView dealId={dealId} snapshotId={snapshotId} />;
}
