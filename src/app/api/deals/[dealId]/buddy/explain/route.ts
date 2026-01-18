import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId().catch(() => null);
  const sb = supabaseAdmin();

  let deal: any = null;
  try {
    const { data } = await sb
      .from("deals")
      .select("id, bank_id, stage, risk_score, borrower_name, entity_type")
      .eq("id", dealId)
      .maybeSingle();
    deal = data ?? null;
  } catch {
    deal = null;
  }

  if (!deal || (bankId && deal.bank_id !== bankId)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  let ledger: any[] = [];
  try {
    const { data } = await sb
      .from("deal_pipeline_ledger")
      .select("created_at, event_type, message, meta")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(25);
    ledger = data ?? [];
  } catch {
    ledger = [];
  }

  const checklistUpdated = (ledger ?? []).find((e: any) => e.event_type === "checklist.updated");
  const missing = checklistUpdated?.meta?.missing ?? null;
  const received = checklistUpdated?.meta?.received ?? null;

  const lines: string[] = [];
  lines.push(`# Buddy — Deal Summary`);
  lines.push("");
  lines.push(`Deal: ${dealId}`);
  if (deal?.borrower_name) lines.push(`Borrower: ${deal.borrower_name}`);
  if (deal?.entity_type) lines.push(`Entity: ${deal.entity_type}`);
  if (deal?.stage) lines.push(`Stage: ${deal.stage}`);
  if (typeof deal?.risk_score === "number") lines.push(`Risk score: ${deal.risk_score}`);
  lines.push("");

  if (received != null || missing != null) {
    lines.push(`## Checklist`);
    lines.push(`Received: ${received ?? "?"}`);
    lines.push(`Missing: ${missing ?? "?"}`);
    lines.push("");
  }

  lines.push(`## What’s next`);
  if (typeof missing === "number" && missing > 0) {
    lines.push(`- Request missing documents from the borrower`);
    lines.push(`- Reconcile checklist after uploads`);
  } else {
    lines.push(`- Proceed to underwriting review`);
  }
  lines.push("");

  lines.push(`## Recent activity`);
  for (const e of ledger ?? []) {
    lines.push(`- ${e.created_at} · ${e.event_type}${e.message ? ` · ${e.message}` : ""}`);
  }

  return NextResponse.json({
    ok: true,
    dealId,
    bankId,
    markdown: lines.join("\n"),
  });
}
