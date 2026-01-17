import { clerkAuth } from "@/lib/auth/clerkServer";
import DealCockpitClient from "@/components/deals/DealCockpitClient";
import { DealCockpitLoadingBar } from "@/components/deals/DealCockpitLoadingBar";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

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
      <div className="container mx-auto p-6" data-testid="deal-cockpit">
        <h1 className="text-2xl font-bold">Deal Cockpit</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Please sign in to view this deal.
        </p>
      </div>
    );
  }

  // Check if user is admin
  const adminIds = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isAdmin = adminIds.includes(userId);

  const { dealId } = await params;

  // 🚫 Do NOT throw/notFound here — client transitions can briefly yield undefined params.
  // Instead render a live status bar + safe loading shell.
  if (!dealId || dealId === "undefined") {
    return (
      <div className="min-h-[60vh]" data-testid="deal-cockpit">
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

  let dealName: { displayName?: string | null; nickname?: string | null; borrowerName?: string | null } | undefined;
  const access = await ensureDealBankAccess(dealId);
  if (access.ok) {
    const sb = supabaseAdmin();
    const { data: deal } = await sb
      .from("deals")
      .select("display_name, nickname, borrower_name")
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();
    dealName = {
      displayName: (deal as any)?.display_name ?? null,
      nickname: (deal as any)?.nickname ?? null,
      borrowerName: (deal as any)?.borrower_name ?? null,
    };
  }

  return (
    <div data-testid="deal-cockpit">
      <DealCockpitClient dealId={dealId} isAdmin={isAdmin} dealName={dealName} />
    </div>
  );
}
