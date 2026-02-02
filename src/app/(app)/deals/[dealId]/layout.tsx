import DealShell from "./DealShell";
import { cache } from "react";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { dealLabel } from "@/lib/deals/dealLabel";
import { getCanonicalMemoStatusForDeals } from "@/lib/creditMemo/canonical/getCanonicalMemoStatusForDeals";

const getDealShellContext = cache(async (dealId: string) => {
  try {
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return null;

    const sb = supabaseAdmin();
    const { data } = await sb
      .from("deals")
      .select("id, display_name, nickname, borrower_name, name, legal_name, amount, stage, risk_score")
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();

    if (!data) return null;

    let intakeBorrowerName: string | null = null;
    if (!data.borrower_name) {
      const { data: intake } = await sb
        .from("deal_intake")
        .select("borrower_name")
        .eq("deal_id", dealId)
        .maybeSingle();
      intakeBorrowerName = intake?.borrower_name ?? null;
    }

    const statusByDeal = await getCanonicalMemoStatusForDeals({
      bankId: access.bankId,
      dealIds: [dealId],
    });

    return {
      deal: {
        id: String(data.id),
        display_name: (data as any).display_name ?? null,
        nickname: (data as any).nickname ?? null,
        borrower_name: (data as any).borrower_name ?? intakeBorrowerName ?? null,
        name: (data as any).name ?? null,
        legal_name: (data as any).legal_name ?? null,
        amount: typeof (data as any).amount === "number" ? (data as any).amount : (data as any).amount ? Number((data as any).amount) : null,
        stage: (data as any).stage ?? null,
        risk_score: (data as any).risk_score ?? null,
      },
      canonicalMemoStatus: statusByDeal[dealId] ?? null,
    };
  } catch (e) {
    console.error("[getDealShellContext] failed:", e);
    return null;
  }
});

export async function generateMetadata(
  props: { params: Promise<{ dealId: string }> }
): Promise<Metadata> {
  try {
    const { dealId } = await props.params;
    const ctx = await getDealShellContext(dealId);
    if (!ctx?.deal) {
      return { title: "Deal • Buddy" };
    }

    return {
      title: `${dealLabel(ctx.deal)} • Buddy`,
    };
  } catch {
    return { title: "Deal • Buddy" };
  }
}

export default async function DealIdLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  const ctx = await getDealShellContext(dealId);

  return (
    <DealShell
      dealId={dealId}
      deal={ctx?.deal ?? null}
      canonicalMemoStatus={ctx?.canonicalMemoStatus ?? null}
    >
      {children}
    </DealShell>
  );
}
