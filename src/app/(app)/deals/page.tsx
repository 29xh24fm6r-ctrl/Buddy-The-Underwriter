import { redirect } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { derivePipelineStatus } from "@/lib/deals/derivePipeline";
import { resolveDealLabel, dealLabel } from "@/lib/deals/dealLabel";
import { isSandboxBank } from "@/lib/tenant/sandbox";
import Link from "next/link";
import GlassToggles from "@/components/ui/GlassToggles";
import { GlassCard, StatusPill, SecondaryCTA } from "@/components/ui/glass";

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
  archived_at?: string | null;
};

function normalizeFilter(value?: string | null) {
  const v = (value ?? "").toLowerCase();
  if (v === "all") return "all";
  if (v === "archived") return "archived";
  return "active";
}

function stageTone(stage: string) {
  const s = stage.toLowerCase();
  if (s.includes("ready")) return "success" as const;
  if (s.includes("underwrite")) return "info" as const;
  if (s.includes("doc") || s.includes("intake")) return "warn" as const;
  return "info" as const;
}

function stageStripe(stage: string) {
  const s = stage.toLowerCase();
  if (s.includes("ready")) return "stage-stripe ready";
  if (s.includes("underwrite")) return "stage-stripe underwrite";
  if (s.includes("doc") || s.includes("intake")) return "stage-stripe needs-docs";
  if (s.includes("intake")) return "stage-stripe intake";
  return "stage-stripe default";
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  const bankId = await getCurrentBankId();
  const demoBank = await isSandboxBank(bankId);
  const params = await searchParams;
  const filter = normalizeFilter(params.filter);
  const sb = supabaseAdmin();

  const selectPrimary =
    "id, display_name, nickname, borrower_name, name, amount, stage, created_at, ready_at, submitted_at, ready_reason, archived_at";
  const selectFallback = "id, borrower_name, name, created_at";

  let deals: DealRow[] = [];
  {
    let query = sb
      .from("deals")
      .select(selectPrimary)
      .eq("bank_id", bankId);

    if (filter === "active") {
      query = query.is("archived_at", null);
    } else if (filter === "archived") {
      query = query.not("archived_at", "is", null);
    }

    const res = await query.order("created_at", { ascending: false }).limit(80);

    if (!res.error) {
      deals = (res.data ?? []) as DealRow[];
    } else {
      const msg = String(res.error.message || "");
      const schemaMaybeMissing = msg.includes("column") || msg.includes("does not exist");

      if (!schemaMaybeMissing) {
        console.error("[/deals] deals_select_failed:", res.error);
      }

      const fallbackRes = await sb
        .from("deals")
        .select(selectFallback)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(80);

      if (fallbackRes.error) {
        console.error("[/deals] deals_select_fallback_failed:", fallbackRes.error);
        deals = [];
      } else {
        deals = (fallbackRes.data ?? []) as DealRow[];
      }
    }
  }

  const uiDeals = deals.map((d) => {
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
    const labelResult = resolveDealLabel({
      id: d.id,
      display_name: d.display_name ?? null,
      nickname: d.nickname ?? null,
      borrower_name: d.borrower_name ?? null,
      name: d.name ?? null,
    });

    const stage = d.stage ? String(d.stage) : "-";

    // If the schema supports these columns, show a human pipeline status. Otherwise, keep it blank.
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
      label: dealLabel({
        id: d.id,
        display_name: d.display_name ?? null,
        nickname: d.nickname ?? null,
        borrower_name: d.borrower_name ?? null,
        name: d.name ?? null,
      }),
      needsName: labelResult.needsName,
      borrower,
      amountLabel,
      stage,
      status,
      createdLabel,
      archivedAt: d.archived_at ?? null,
    };
  });

  const stats = {
    active: uiDeals.filter((d) => !d.archivedAt).length,
    ready: uiDeals.filter((d) => (d.status || "").toLowerCase().includes("ready")).length,
    underwrite: uiDeals.filter((d) => (d.stage || "").toLowerCase().includes("underwrite")).length,
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a]" data-testid="deals-page">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0f172a] px-6 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-white">Deals Pipeline</h1>
              {demoBank ? (
                <span className="status-pill info">Demo Bank</span>
              ) : null}
            </div>
            <p className="text-sm text-white/60">
              A clean, organized view of active underwriting work.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-white/70">
              <span className="rounded-full border border-white/10 px-3 py-1">Active {stats.active}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Ready {stats.ready}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Underwrite {stats.underwrite}</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <GlassToggles />
            <input
              type="search"
              placeholder="Search deals..."
              className="px-4 py-2 bg-[#111827] border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            />
            <Link href="/deals/new">
              <span className="gradient-cta inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white">
                <span className="material-symbols-outlined inline-block align-middle text-[20px]">add</span>
                New Deal
              </span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: "Active", value: "active" },
            { label: "All", value: "all" },
            { label: "Archived", value: "archived" },
          ].map((chip) => (
            <Link
              key={chip.value}
              href={`/deals?filter=${chip.value}`}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                filter === chip.value ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/70"
              }`}
            >
              {chip.label}
            </Link>
          ))}
        </div>

        <GlassCard className="overflow-hidden">
          <table className="w-full">
            <thead className="glass-header">
              <tr>
                <th className="px-6 py-3 text-left text-[11px] font-semibold text-white/70 uppercase tracking-wider">
                  Deal
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-semibold text-white/70 uppercase tracking-wider">
                  Borrower
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-semibold text-white/70 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-semibold text-white/70 uppercase tracking-wider">
                  Stage
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-semibold text-white/70 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-semibold text-white/70 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-semibold text-white/70 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {uiDeals.map((deal) => (
                <tr key={deal.id} className="glass-row">
                  <td className="px-6 py-4 text-sm font-medium text-white">
                    <div className="flex items-center gap-3">
                      <span className={stageStripe(deal.stage)} />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/deals/${deal.id}/cockpit`}
                            className="truncate max-w-[240px] hover:underline focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                            title={deal.label}
                            data-testid={`deal-link-${deal.id}`}
                          >
                            {deal.label}
                          </Link>
                          {deal.needsName ? (
                            <span className="status-pill warn">Needs name</span>
                          ) : null}
                        </div>
                        <div className="text-xs text-white/50">{deal.borrower}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.borrower}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.amountLabel}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.stage}
                  </td>
                  <td className="px-6 py-4">
                    {deal.status ? (
                      <StatusPill tone={stageTone(deal.status)} label={deal.status} />
                    ) : (
                      <span className="text-xs text-white/40">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.createdLabel}
                  </td>
                  <td className="px-6 py-4 text-right text-sm">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/underwrite/${deal.id}`}>
                        <span className="gradient-cta inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white">
                          Open Underwriting
                          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                        </span>
                      </Link>
                      <Link href={`/deals/${deal.id}`}>
                        <SecondaryCTA>Open</SecondaryCTA>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>

        {uiDeals.length === 0 && (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-white/20 text-6xl">folder_open</span>
            <p className="text-white/60 mt-4">No deals yet. Create your first deal to get started.</p>
          </div>
        )}
      </main>
    </div>
  );
}
