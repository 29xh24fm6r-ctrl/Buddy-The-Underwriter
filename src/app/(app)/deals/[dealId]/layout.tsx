import DealShell from "./DealShell";
import { cache } from "react";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { dealLabel } from "@/lib/deals/dealLabel";
import {
  buildDealNameProjection,
  DEAL_NAME_SELECT,
} from "@/lib/deals/dealNameProjection";
import { getCanonicalMemoStatusForDeals } from "@/lib/creditMemo/canonical/getCanonicalMemoStatusForDeals";
import { resolveDealLoanAmount } from "@/lib/loanRequests/resolveDealLoanAmount";

const getDealShellContext = cache(async (dealId: string) => {
  try {
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return null;

    const sb = supabaseAdmin();
    // Name columns come from the canonical DEAL_NAME_SELECT (the deals table has
    // no legal-name column); amount/stage/risk_score/deal_type are appended for
    // the header stats.
    const { data } = await sb
      .from("deals")
      .select(`${DEAL_NAME_SELECT}, amount, stage, risk_score, deal_type`)
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

    // Single source of truth for the name fields handed to the shell.
    const nameProjection = buildDealNameProjection(dealId, data, {
      intakeBorrowerName,
    });

    const statusByDeal = await getCanonicalMemoStatusForDeals({
      bankId: access.bankId,
      dealIds: [dealId],
    });

    // SPEC-JOURNEY-RAIL-UNDERWRITING-FLOW-PRIORITY-1: the header "Loan" stat reads deals.amount, but
    // that column is often null until a banker fills it in. Fall back to the active submitted loan
    // request amount so the header reflects the borrower's actual ask. Only queried when amount is null.
    const rawAmount =
      typeof (data as any).amount === "number"
        ? (data as any).amount
        : (data as any).amount
          ? Number((data as any).amount)
          : null;
    let resolvedAmount = rawAmount;
    if (resolvedAmount == null) {
      const { data: loanRequests } = await sb
        .from("deal_loan_requests")
        .select("status, requested_amount, request_number")
        .eq("deal_id", dealId);
      resolvedAmount = resolveDealLoanAmount(null, (loanRequests ?? []) as any[]);
    }

    return {
      deal: {
        id: nameProjection.id,
        display_name: nameProjection.display_name,
        nickname: nameProjection.nickname,
        borrower_name: nameProjection.borrower_name,
        name: nameProjection.name,
        amount: resolvedAmount,
        stage: (data as any).stage ?? null,
        risk_score: (data as any).risk_score ?? null,
        deal_type: (data as any).deal_type ?? null,
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
