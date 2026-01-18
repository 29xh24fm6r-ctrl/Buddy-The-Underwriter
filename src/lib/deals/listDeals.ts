import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { derivePipelineStatus } from "@/lib/deals/derivePipeline";
import { resolveDealLabel } from "@/lib/deals/dealLabel";

export type DealSummary = {
  id: string;
  name: string | null;
  displayName: string | null;
  nickname: string | null;
  borrowerName: string | null;
  label: string;
  labelSource: "display_name" | "nickname" | "borrower_name" | "name" | "legal_name" | "fallback";
  needsName: boolean;
  borrower: string;
  amountLabel: string;
  stage: string;
  stageLabel: string;
  status: string | null;
  createdLabel: string;
};

function formatMoney(amount: unknown): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

type DealRow = {
  id: string;
  display_name?: string | null;
  nickname?: string | null;
  borrower_name?: string | null;
  name?: string | null;
  amount?: number | string | null;
  stage?: string | null;
  created_at?: string | null;
  ready_at?: string | null;
  submitted_at?: string | null;
  ready_reason?: string | null;
};

export async function listDealsForBank(limit = 50): Promise<DealSummary[]> {
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const selectPrimary =
    "id, display_name, nickname, borrower_name, name, amount, stage, created_at, ready_at, submitted_at, ready_reason";
  const selectFallback = "id, borrower_name, name, created_at";

  let deals: DealRow[] = [];
  const res = await sb
    .from("deals")
    .select(selectPrimary)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!res.error) {
    deals = (res.data ?? []) as DealRow[];
  } else {
    const msg = String(res.error.message || "");
    const schemaMaybeMissing = msg.includes("column") || msg.includes("does not exist");

    if (!schemaMaybeMissing) {
      console.error("[listDealsForBank] deals_select_failed:", res.error);
    }

    const fallbackRes = await sb
      .from("deals")
      .select(selectFallback)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (fallbackRes.error) {
      console.error("[listDealsForBank] deals_select_fallback_failed:", fallbackRes.error);
      deals = [];
    } else {
      deals = (fallbackRes.data ?? []) as DealRow[];
    }
  }

  return deals.map((d) => {
    const createdAt = d.created_at ? new Date(d.created_at) : null;
    const createdLabel = createdAt
      ? createdAt.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
        })
      : "-";

    const borrower = d.borrower_name || d.name || "Untitled deal";
    const amountLabel = d.amount != null ? formatMoney(d.amount) : "-";
    const stage = d.stage ? String(d.stage) : "-";

    const labelResult = resolveDealLabel({
      id: d.id,
      display_name: d.display_name ?? null,
      nickname: d.nickname ?? null,
      borrower_name: d.borrower_name ?? null,
      name: d.name ?? null,
      legal_name: (d as any).legal_name ?? null,
    });

    let status: string | null = null;
    if ("submitted_at" in d || "ready_at" in d) {
      try {
        status = derivePipelineStatus(d as any);
      } catch {
        status = null;
      }
    }

    return {
      id: d.id,
      name: d.name ?? d.borrower_name ?? null,
      displayName: d.display_name ?? null,
      nickname: d.nickname ?? null,
      borrowerName: d.borrower_name ?? null,
      label: labelResult.label,
      labelSource: labelResult.source,
      needsName: labelResult.needsName,
      borrower,
      amountLabel,
      stage,
      stageLabel: stage,
      status,
      createdLabel,
    };
  });
}
