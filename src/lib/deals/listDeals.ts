import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { derivePipelineStatus } from "@/lib/deals/derivePipeline";

export type DealSummary = {
  id: string;
  borrower: string;
  amountLabel: string;
  stage: string;
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

  const selectPrimary = "id, borrower_name, name, amount, stage, created_at, ready_at, submitted_at, ready_reason";
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
      borrower,
      amountLabel,
      stage,
      status,
      createdLabel,
    };
  });
}
