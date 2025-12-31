import { auth } from "@clerk/nextjs/server";
import DealCockpitClient from "@/components/deals/DealCockpitClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: { dealId?: string };
};

export default async function DealCockpitPage({ params }: Props) {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Deal Cockpit</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Please sign in to view this deal.
        </p>
      </div>
    );
  }

  const dealId = params?.dealId;

  // Soft fallback for hydration issues (DO NOT hard-404 here)
  if (!dealId || dealId === "undefined") {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Loading deal…</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Resolving deal context. If this persists, refresh the page.
        </p>
      </div>
    );
  }

  return <DealCockpitClient dealId={dealId} />;
}
