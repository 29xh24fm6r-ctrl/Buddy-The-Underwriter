import DealShell from "./DealShell";
import { cache } from "react";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { dealLabel } from "@/lib/deals/dealLabel";
import { loadDealNameProjection } from "@/lib/deals/loadDealNameProjection";
import { getCanonicalMemoStatusForDeals } from "@/lib/creditMemo/canonical/getCanonicalMemoStatusForDeals";
import { resolveDealLoanAmount } from "@/lib/loanRequests/resolveDealLoanAmount";

const getDealShellContext = cache(async (dealId: string) => {
  try {
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return null;

    // SPEC-DEAL-SHELL-ACTUALLY-USES-NAME-PROJECTION-1: the deal name is loaded
    // ONLY through the schema-safe projection loader (its own minimal-select
    // retry + intake borrower-name fallback). The layout never selects naming
    // columns directly, so a missing optional column can never collapse the
    // shell to "Deal <short-id>" / NEEDS NAME on a hard refresh.
    const nameProjection = await loadDealNameProjection(dealId, access.bankId);
    if (!nameProjection) return null;

    const sb = supabaseAdmin();

    // Header stats are non-critical. Their query is isolated so that a failure
    // (e.g. a missing optional column, a timeout) can NEVER affect whether the
    // name renders — we already have nameProjection at this point.
    let stats: {
      amount: number | string | null;
      stage: string | null;
      risk_score: number | null;
      deal_type: string | null;
    } = { amount: null, stage: null, risk_score: null, deal_type: null };
    try {
      const { data: statsRow } = await sb
        .from("deals")
        .select("amount, stage, risk_score, deal_type")
        .eq("id", dealId)
        .eq("bank_id", access.bankId)
        .maybeSingle();
      if (statsRow) stats = statsRow as typeof stats;
    } catch (e) {
      console.warn("[getDealShellContext] stats query failed (name unaffected):", e);
    }

    let canonicalMemoStatus: Awaited<
      ReturnType<typeof getCanonicalMemoStatusForDeals>
    >[string] | null = null;
    try {
      const statusByDeal = await getCanonicalMemoStatusForDeals({
        bankId: access.bankId,
        dealIds: [dealId],
      });
      canonicalMemoStatus = statusByDeal[dealId] ?? null;
    } catch (e) {
      console.warn("[getDealShellContext] memo status failed (name unaffected):", e);
    }

    // SPEC-JOURNEY-RAIL-UNDERWRITING-FLOW-PRIORITY-1: the header "Loan" stat reads deals.amount, but
    // that column is often null until a banker fills it in. Fall back to the active submitted loan
    // request amount so the header reflects the borrower's actual ask. Only queried when amount is null.
    const rawAmount =
      typeof stats.amount === "number"
        ? stats.amount
        : stats.amount
          ? Number(stats.amount)
          : null;
    let resolvedAmount = rawAmount;
    if (resolvedAmount == null) {
      try {
        const { data: loanRequests } = await sb
          .from("deal_loan_requests")
          .select("status, requested_amount, request_number")
          .eq("deal_id", dealId);
        resolvedAmount = resolveDealLoanAmount(null, (loanRequests ?? []) as any[]);
      } catch (e) {
        console.warn("[getDealShellContext] loan amount failed (name unaffected):", e);
      }
    }

    return {
      deal: {
        id: nameProjection.id,
        display_name: nameProjection.display_name,
        nickname: nameProjection.nickname,
        borrower_name: nameProjection.borrower_name,
        name: nameProjection.name,
        amount: resolvedAmount,
        stage: stats.stage ?? null,
        risk_score: stats.risk_score ?? null,
        deal_type: stats.deal_type ?? null,
      },
      canonicalMemoStatus,
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
