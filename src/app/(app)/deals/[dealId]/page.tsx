// src/app/deals/[dealId]/page.tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DealPage({
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

  // Redirect to command center
  redirect(`/deals/${dealId}/command`);
}
