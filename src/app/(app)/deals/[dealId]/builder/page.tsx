import { Suspense } from "react";
import { redirect } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadBuilderPrefill } from "@/lib/builder/builderPrefill";
import BuilderPageClient from "@/components/builder/BuilderPageClient";
import type { CollateralItem, ProceedsItem, ServerFlags } from "@/lib/builder/builderTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ dealId?: string }>;
};

export default async function BuilderPage({ params }: Props) {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in"); // type guard — middleware owns auth

  const { dealId } = await params;

  if (!dealId || dealId === "undefined") {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold text-white">Loading deal\u2026</h1>
      </div>
    );
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-bold text-white">Access Denied</h1>
          <p className="text-sm text-white/60">You do not have permission to view this deal.</p>
          <a href="/deals" className="inline-flex items-center rounded-lg bg-white/10 border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">
            Back to Deals
          </a>
        </div>
      </div>
    );
  }

  const sb = supabaseAdmin();

  // Sequential fetches (no FK-dependent joins)
  const { data: dealRow } = await sb
    .from("deals")
    .select("name, display_name, nickname, borrower_name, loan_amount, stage")
    .eq("id", dealId)
    .maybeSingle();

  const dealName =
    (dealRow as any)?.display_name ||
    (dealRow as any)?.nickname ||
    (dealRow as any)?.borrower_name ||
    (dealRow as any)?.name ||
    "Untitled Deal";

  const { data: sectionRows } = await sb
    .from("deal_builder_sections")
    .select("section_key, data, updated_at")
    .eq("deal_id", dealId);

  const sections: Record<string, { data: unknown; updated_at: string }> = {};
  for (const row of sectionRows ?? []) {
    sections[row.section_key] = { data: row.data, updated_at: row.updated_at };
  }

  const { data: collateralRows } = await sb
    .from("deal_collateral_items")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  const { data: proceedsRows } = await sb
    .from("deal_proceeds_items")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  // Server flags: check if snapshot exists, docs ready, risk run exists
  const { data: snapshotFact } = await sb
    .from("deal_financial_facts")
    .select("id")
    .eq("deal_id", dealId)
    .eq("fact_key", "DSCR")
    .limit(1)
    .maybeSingle();

  const { data: riskRun } = await sb
    .from("ai_risk_runs")
    .select("id")
    .eq("deal_id", dealId)
    .limit(1)
    .maybeSingle();

  const serverFlags: ServerFlags = {
    snapshotExists: Boolean(snapshotFact?.id),
    documentsReady: false, // Would need lifecycle state; conservative default
    riskRunExists: Boolean(riskRun?.id),
  };

  const prefill = await loadBuilderPrefill(dealId, sb);

  return (
    <Suspense
      fallback={
        <div className="min-h-screen text-white flex items-center justify-center">
          <div className="animate-pulse text-white/30 text-sm">Loading builder...</div>
        </div>
      }
    >
      <BuilderPageClient
        dealId={dealId}
        dealName={dealName}
        stage={(dealRow as any)?.stage ?? null}
        initialSections={sections}
        initialCollateral={(collateralRows ?? []) as CollateralItem[]}
        initialProceeds={(proceedsRows ?? []) as ProceedsItem[]}
        prefill={prefill}
        serverFlags={serverFlags}
      />
    </Suspense>
  );
}
