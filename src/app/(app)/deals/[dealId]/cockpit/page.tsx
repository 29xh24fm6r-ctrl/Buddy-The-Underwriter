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
  let readiness: {
    named: boolean;
    borrowerAttached: boolean;
    documentsReady: boolean;
    financialSnapshotReady: boolean;
    requiredDocsCount: number;
    missingDocsCount: number;
  } | null = null;
  let lifecycleStage: string | null = null;
  let intakeInitialized = false;
  let ignitedEvent: { source: string | null; createdAt: string | null } | null = null;
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
      .select("display_name, nickname, borrower_name, borrower_id, lifecycle_stage")
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();
    dealName = {
      displayName: (deal as any)?.display_name ?? null,
      nickname: (deal as any)?.nickname ?? null,
      borrowerName: (deal as any)?.borrower_name ?? null,
    };
    lifecycleStage = (deal as any)?.lifecycle_stage ?? null;

    const hasDisplayName = Boolean(
      (deal as any)?.display_name && String((deal as any).display_name).trim(),
    );
    const hasNickname = Boolean(
      (deal as any)?.nickname && String((deal as any).nickname).trim(),
    );
    const borrowerAttached = Boolean((deal as any)?.borrower_id);

    const { data: checklist } = await sb
      .from("deal_checklist_items")
      .select("checklist_key, required, received_at")
      .eq("deal_id", dealId)
      .eq("required", true);

    const missingDocsCount = (checklist ?? []).filter((item: any) => !item.received_at).length;
    const requiredDocsCount = (checklist ?? []).length;
    const documentsReady = requiredDocsCount > 0 && missingDocsCount === 0;

    const { count: snapshotCount } = await sb
      .from("financial_snapshot_decisions")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    const financialSnapshotReady = Boolean(snapshotCount && snapshotCount > 0);

    readiness = {
      named: hasDisplayName || hasNickname,
      borrowerAttached,
      documentsReady,
      financialSnapshotReady,
      requiredDocsCount,
      missingDocsCount,
    };

    const { data: intake } = await sb
      .from("deal_intake")
      .select("id")
      .eq("deal_id", dealId)
      .maybeSingle();
    intakeInitialized = Boolean(intake?.id);

    const { data: latestIgnite } = await sb
      .from("audit_ledger")
      .select("created_at,input_json")
      .eq("deal_id", dealId)
      .eq("kind", "deal.ignited")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const source =
      (latestIgnite as any)?.input_json?.source ??
      (latestIgnite as any)?.input_json?.input?.source ??
      null;

    if (latestIgnite) {
      ignitedEvent = {
        source,
        createdAt: (latestIgnite as any)?.created_at ?? null,
      };
    }

    verify = await verifyUnderwrite({ dealId, actor: "banker" });
  }

  return (
    <div data-testid="deal-cockpit">
      <DealCockpitClient
        dealId={dealId}
        isAdmin={isAdmin}
        dealName={dealName}
        readiness={readiness}
        lifecycleStage={lifecycleStage}
        ignitedEvent={ignitedEvent}
        intakeInitialized={intakeInitialized}
        verify={verify}
      />
    </div>
  );
}
