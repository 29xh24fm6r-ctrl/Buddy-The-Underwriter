import { clerkAuth } from "@/lib/auth/clerkServer";
import DealCockpitClient from "@/components/deals/DealCockpitClient";
import { DealCockpitLoadingBar } from "@/components/deals/DealCockpitLoadingBar";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";

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

  let dealName: { displayName?: string | null; nickname?: string | null; borrowerName?: string | null } | undefined;
  let verify: VerifyUnderwriteResult = {
    ok: false,
    dealId,
    auth: true,
    recommendedNextAction: "deal_not_found",
    diagnostics: {},
    ledgerEventsWritten: [],
  };
  const access = await ensureDealBankAccess(dealId);
  if (access.ok) {
    const sb = supabaseAdmin();
    const { data: deal } = await sb
      .from("deals")
      .select("display_name, nickname, borrower_name")
      .eq("id", dealId)
      .maybeSingle();
    dealName = {
      displayName: (deal as any)?.display_name ?? null,
      nickname: (deal as any)?.nickname ?? null,
      borrowerName: (deal as any)?.borrower_name ?? null,
    };
    verify = await verifyUnderwrite({ dealId, actor: "banker" });
  }

  return (
    <DealCockpitClient
      dealId={dealId}
      isAdmin={isAdmin}
      dealName={dealName}
      verify={verify}
    />
  );
}
