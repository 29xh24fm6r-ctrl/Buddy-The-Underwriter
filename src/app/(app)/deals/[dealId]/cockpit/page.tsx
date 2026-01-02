import { clerkAuth } from "@/lib/auth/clerkServer";
import DealCockpitClient from "@/components/deals/DealCockpitClient";
import { DealCockpitLoadingBar } from "@/components/deals/DealCockpitLoadingBar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  // Next.js App Router (Next 15): params may be delivered as a Promise in server components.
  params: Promise<{ dealId?: string }>;
};

export default async function DealCockpitPage({ params }: Props) {
  const { userId } = await clerkAuth();

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

  const { dealId } = await params;

  // 🚫 Do NOT throw/notFound here — client transitions can briefly yield undefined params.
  // Instead render a live status bar + safe loading shell.
  if (!dealId || dealId === "undefined") {
    return (
      <div className="min-h-[60vh]">
        <DealCockpitLoadingBar dealId={dealId ?? null} />
        <div className="container mx-auto p-6">
          <h1 className="text-2xl font-bold text-neutral-100">Loading deal…</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Resolving deal context. If this persists, click <span className="font-semibold">Hard refresh</span> above.
          </p>
        </div>
      </div>
    );
  }

  return <DealCockpitClient dealId={dealId} />;
}
