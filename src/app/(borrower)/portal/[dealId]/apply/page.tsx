// Phase 53C stub — Borrower Portal Apply
// This route exists now but renders a Coming Soon placeholder until Phase 53C.

export const runtime = "nodejs";

type Props = {
  params: Promise<{ dealId?: string }>;
};

export default async function BorrowerApplyPage({ params }: Props) {
  const { dealId } = await params;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 border border-blue-100">
          <span className="material-symbols-outlined text-blue-500 text-3xl">description</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Borrower Application</h1>
        <p className="text-sm text-gray-500">
          The borrower application portal is coming soon. Your banker will contact
          you when this feature is available.
        </p>
        {dealId && (
          <p className="text-xs text-gray-400">Deal: {dealId}</p>
        )}
      </div>
    </div>
  );
}
