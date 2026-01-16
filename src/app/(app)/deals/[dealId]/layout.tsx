import DealShell from "./DealShell";
import { cache } from "react";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { dealLabel } from "@/lib/deals/dealLabel";

const getDealShellDeal = cache(async (dealId: string) => {
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return null;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("deals")
    .select("id, display_name, nickname, borrower_name, name, amount, stage, risk_score")
    .eq("id", dealId)
    .eq("bank_id", access.bankId)
    .maybeSingle();

  if (!data) return null;

  return {
    id: String(data.id),
    display_name: (data as any).display_name ?? null,
    nickname: (data as any).nickname ?? null,
    borrower_name: (data as any).borrower_name ?? null,
    name: (data as any).name ?? null,
    amount: typeof (data as any).amount === "number" ? (data as any).amount : (data as any).amount ? Number((data as any).amount) : null,
    stage: (data as any).stage ?? null,
    risk_score: (data as any).risk_score ?? null,
  };
});

export async function generateMetadata(
  props: { params: Promise<{ dealId: string }> }
): Promise<Metadata> {
  try {
    const { dealId } = await props.params;
    const deal = await getDealShellDeal(dealId);
    if (!deal) {
      return { title: "Deal • Buddy" };
    }

    return {
      title: `${dealLabel(deal)} • Buddy`,
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

  const deal = await getDealShellDeal(dealId);

  return (
    <DealShell dealId={dealId} deal={deal}>
      {children}
    </DealShell>
  );
}
