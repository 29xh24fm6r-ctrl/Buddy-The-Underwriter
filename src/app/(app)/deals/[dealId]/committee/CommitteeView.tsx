import StitchSurface from "@/stitch/StitchSurface";
import CommitteeDecisionPanel from "@/app/(app)/deals/[dealId]/committee/CommitteeDecisionPanel";

type SnapshotInfo = {
  createdAt: string;
};

export function CommitteeView({
  dealId,
  borrowerName,
  borrowerEntityType,
  snapshot,
}: {
  dealId: string;
  borrowerName: string;
  borrowerEntityType: string;
  snapshot?: SnapshotInfo | null;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Committee Review
            </h1>
            <p className="text-sm text-gray-500">
              {borrowerName} · {borrowerEntityType}
            </p>
          </div>

          {snapshot && (
            <div className="rounded-lg bg-blue-50 px-4 py-2">
              <div className="text-xs text-blue-600">Snapshot</div>
              <div className="text-sm font-medium text-blue-900">
                {new Date(snapshot.createdAt).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stitch Embedded View (Read-only) */}
      <div className="p-6">
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <StitchSurface
            surfaceKey="credit_committee"
            dealId={dealId}
            title="Committee Deal Summary"
            mode="iframe"
          />
        </div>

        {/* Decision Panel (Only Write Action) */}
        <CommitteeDecisionPanel dealId={dealId} />
      </div>
    </div>
  );
}
