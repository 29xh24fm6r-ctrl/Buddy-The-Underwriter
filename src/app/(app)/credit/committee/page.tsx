/**
 * /credit/committee — Credit Committee View
 *
 * SPEC-COMMITTEE-READY-FLOW-1 — Fix 3.
 *
 * Replaced the prior Stitch iframe (which surfaced a design-prototype
 * "Project Atlas" mock) with a native page that queries real deals
 * filtered by the banker's current bank and lifecycle stage. Each card
 * links to the decision page where the banker records the committee
 * decision.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { dealLabel } from "@/lib/deals/dealLabel";

export const dynamic = "force-dynamic";

type CommitteeDealRow = {
  id: string;
  display_name: string | null;
  nickname: string | null;
  borrower_name: string | null;
  name: string | null;
  legal_name: string | null;
  amount: number | null;
  deal_type: string | null;
  lifecycle_stage: string | null;
  updated_at: string | null;
};

type SnapshotRow = {
  deal_id: string;
  snapshot_json: Record<string, any> | null;
  created_at: string;
};

const COMMITTEE_STAGES = ["committee_ready", "underwrite_in_progress"] as const;

export default async function Page() {
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;
  const sb = supabaseAdmin();

  const { data: deals } = await sb
    .from("deals")
    .select(
      "id, display_name, nickname, borrower_name, name, legal_name, amount, deal_type, lifecycle_stage, updated_at",
    )
    .eq("bank_id", bankId)
    .in("lifecycle_stage", COMMITTEE_STAGES as unknown as string[])
    .order("updated_at", { ascending: false });

  const dealRows = (deals ?? []) as CommitteeDealRow[];

  // Pull the latest financial snapshot per deal so we can show DSCR.
  const snapshotByDeal = new Map<string, SnapshotRow>();
  if (dealRows.length) {
    const { data: snapshots } = await sb
      .from("financial_snapshots")
      .select("deal_id, snapshot_json, created_at")
      .in(
        "deal_id",
        dealRows.map((d) => d.id),
      )
      .order("created_at", { ascending: false });

    for (const row of (snapshots ?? []) as SnapshotRow[]) {
      if (!snapshotByDeal.has(row.deal_id)) snapshotByDeal.set(row.deal_id, row);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-white">Credit Committee</h1>
        <p className="mt-1 text-sm text-white/60">
          Deals ready for committee review or in active underwriting at your bank.
        </p>
      </header>

      {dealRows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {dealRows.map((d) => {
            const snap = snapshotByDeal.get(d.id)?.snapshot_json ?? null;
            const dscr = readNum(snap?.dscr?.value_num);
            const label = dealLabel({
              id: d.id,
              display_name: d.display_name,
              nickname: d.nickname,
              borrower_name: d.borrower_name,
              name: d.name,
              legal_name: d.legal_name,
            });
            const displayLabel = label || "Unnamed deal";
            return (
              <li key={d.id}>
                <Link
                  href={`/deals/${d.id}/decision`}
                  className="block rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.05] transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {displayLabel}
                      </div>
                      <div className="mt-0.5 text-xs text-white/50 truncate">
                        {d.deal_type ?? "—"}
                      </div>
                    </div>
                    <StageBadge stage={d.lifecycle_stage} />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <Metric label="Loan Amount" value={formatAmount(d.amount)} />
                    <Metric label="DSCR" value={dscr == null ? "—" : `${dscr.toFixed(2)}x`} />
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-white/40">{label}</dt>
      <dd className="text-sm font-semibold text-white">{value}</dd>
    </div>
  );
}

function StageBadge({ stage }: { stage: string | null }) {
  const isReady = stage === "committee_ready";
  const cls = isReady
    ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30"
    : "bg-amber-600/20 text-amber-200 border-amber-500/30";
  const label = isReady ? "Ready" : "In Underwriting";
  return (
    <span
      className={[
        "shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        cls,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center">
      <div className="text-sm text-white/70">
        No deals are currently in underwriting or ready for committee.
      </div>
      <Link
        href="/deals"
        className="mt-3 inline-block rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
      >
        Browse all deals
      </Link>
    </div>
  );
}

function readNum(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function formatAmount(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
