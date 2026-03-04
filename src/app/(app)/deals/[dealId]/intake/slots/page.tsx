import { Suspense } from "react";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import EntitySlotBindingPage from "./EntitySlotBindingPage";

export const dynamic = "force-dynamic";

export default async function IntakeSlotsPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <main className="min-h-screen p-10 text-neutral-600">
        Unable to access this deal.
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20 text-neutral-400">
            Loading...
          </div>
        }
      >
        <EntitySlotBindingPage dealId={dealId} />
      </Suspense>
    </main>
  );
}
