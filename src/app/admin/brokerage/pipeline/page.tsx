import "server-only";

import Link from "next/link";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { derivePipelineStatus } from "@/lib/deals/derivePipeline";
import { resolveDealLabel } from "@/lib/deals/dealLabel";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { RefinedStamp } from "@/components/brokerage/StatusStamp";

export const dynamic = "force-dynamic";

/**
 * /admin/brokerage/pipeline — the brokerage's own working deals list.
 *
 * Deliberately forked from the shared (app)/deals/page.tsx rather than
 * reskinning it in place: that page is generic, tenant-agnostic code
 * used by every bank tenant on the platform (it filters by whatever
 * bank_id tryGetCurrentBankId() resolves to — no bank_kind check, no
 * brokerage-specific logic). Reskinning it in place would change what
 * bank clients see too, and risks cross-contaminating brokerage-specific
 * assumptions into shared code. This page hard-codes the brokerage
 * bank_id instead, and reuses the same underlying helpers (resolveDealLabel,
 * derivePipelineStatus) rather than duplicating that logic.
 *
 * Individual deals still link to /deals/[id]/cockpit — the real shared
 * underwriting workspace (intake/documents/underwriting/pricing/credit
 * memo/servicing). That's genuine shared machinery the brokerage also
 * needs, not cosmetic, so it's intentionally not forked.
 */

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

function formatMoney(amount: unknown): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

const GRID = "80px minmax(0,1fr) 118px 148px 100px 100px";

export default async function BrokeragePipelinePage() {
  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const selectPrimary =
    "id, display_name, nickname, borrower_name, name, amount, stage, created_at, ready_at, submitted_at, ready_reason, archived_at";

  const { data, error } = await sb
    .from("deals")
    .select(selectPrimary)
    .eq("bank_id", brokerageBankId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(80);

  const deals: DealRow[] = error ? [] : ((data ?? []) as DealRow[]);

  const rows = deals.map((d) => {
    const labelResult = resolveDealLabel({
      id: d.id,
      display_name: d.display_name ?? null,
      nickname: d.nickname ?? null,
      borrower_name: d.borrower_name ?? null,
      name: d.name ?? null,
    });
    let status: string | null = null;
    try {
      status = derivePipelineStatus(d as any);
    } catch {
      status = null;
    }
    const createdAt = d.created_at ? new Date(d.created_at) : null;
    return {
      id: d.id,
      business: labelResult.label,
      borrower: d.borrower_name || d.name || "Untitled deal",
      amount: formatMoney(d.amount),
      stage: d.stage ? String(d.stage) : "—",
      status: status ?? "—",
      created: createdAt ? createdAt.toLocaleDateString("en-US", { month: "short", day: "2-digit" }) : "—",
    };
  });

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            padding: "9px 16px",
            borderBottom: `1px solid ${c.borderStrong}`,
            background: c.inkHeader,
            fontFamily: "var(--font-brokerage-mono)",
            fontSize: 9.5,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: c.textFaint,
          }}
        >
          <div>Deal</div>
          <div>Borrower</div>
          <div style={{ textAlign: "right" }}>Loan</div>
          <div>Stage</div>
          <div>Status</div>
          <div style={{ textAlign: "right" }}>Opened</div>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: "54px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 30, opacity: 0.35, marginBottom: 8 }}>▦</div>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontSize: 16, color: "#C9C3B6", marginBottom: 4 }}>
              No deals in the pipeline
            </div>
            <div style={{ fontSize: 12, color: c.textMuted }}>New work shows up here as it arrives from your referral sources.</div>
          </div>
        ) : (
          rows.map((d) => (
            <Link
              key={d.id}
              href={`/deals/${d.id}/cockpit`}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                padding: "11px 16px",
                borderBottom: `1px solid ${c.divider}`,
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 11, color: c.brass }}>
                {d.id.slice(0, 8)}
              </div>
              <div style={{ minWidth: 0, paddingRight: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: c.paper, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.business}
                </div>
                <div style={{ fontSize: 10.5, color: c.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.borrower}
                </div>
              </div>
              <div style={{ textAlign: "right", fontFamily: "var(--font-brokerage-mono)", fontSize: 12.5, color: c.paper, paddingRight: 14 }}>
                {d.amount}
              </div>
              <div style={{ fontSize: 11, color: "#C9C3B6" }}>{d.stage}</div>
              <div>
                <RefinedStamp status={d.status} />
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: c.textMuted, fontFamily: "var(--font-brokerage-mono)" }}>
                {d.created}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
