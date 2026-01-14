import { clerkAuth } from "@/lib/auth/clerkServer";
import DealCockpitClient from "@/components/deals/DealCockpitClient";
import { DealCockpitLoadingBar } from "@/components/deals/DealCockpitLoadingBar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  // Next.js App Router (Next 15+): params may be delivered as a Promise in server components.
  params: Promise<{ dealId?: string }>;
};

/**
 * Deal Overview ("Overview" tab)
 *
 * Stitch mock replaced with the real deal cockpit.
 */
export default async function UnderwriterOverviewPage({ params }: Props) {
  const { userId } = await clerkAuth();

  if (!userId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Deal Overview</h1>
        <p className="mt-2 text-sm text-white/70">
          Please sign in to view this deal.
        </p>
      </div>
    );
  }

  const adminIds = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isAdmin = adminIds.includes(userId);

  const { dealId } = await params;

  // 🚫 Do NOT throw/notFound here — client transitions can briefly yield undefined params.
  if (!dealId || dealId === "undefined") {
    return (
      <div className="min-h-[60vh]">
        <DealCockpitLoadingBar dealId={dealId ?? null} />
        <div className="p-6">
          <h1 className="text-2xl font-bold text-white">Loading deal…</h1>
          <p className="mt-2 text-sm text-white/70">
            Resolving deal context. If this persists, hard refresh.
          </p>
        </div>
      </div>
    );
  }

  return <DealCockpitClient dealId={dealId} isAdmin={isAdmin} />;
}
