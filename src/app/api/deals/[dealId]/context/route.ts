// src/app/api/deals/[dealId]/context/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import type { DealContext } from "@/lib/deals/contextTypes";

export const dynamic = "force-dynamic";

type ProbeOk = {
  ok: true;
  deal: { id: string; bank_id: string | null; created_at: string | null };
  ensured_bank: { ok: true; bankId: string; updated: boolean } | null;
  server_ts: string;
};

type ProbeErr = { ok: false; error: string; details?: string | null; dealId?: string | null; hint?: string };

export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    if (!dealId || dealId === "undefined") {
      return NextResponse.json({ ok: false, error: "invalid_deal_id", dealId: dealId ?? null } satisfies ProbeErr, { status: 400 });
    }

    const bankId = await getCurrentBankId().catch((e) => {
      console.error(`[context] getCurrentBankId failed for dealId ${dealId}:`, e);
      return null;
    });
    const sb = supabaseAdmin();

    // 1) Load deal by id first (do NOT filter by bank_id here — we validate after)
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id, borrower_name, entity_type, stage, risk_score, created_at")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr) {
      return NextResponse.json(
        { ok: false, error: "deal_load_failed", details: dealErr.message, dealId } satisfies ProbeErr,
        { status: 500 }
      );
    }

    if (!deal) {
      return NextResponse.json(
        { 
          ok: false, 
          error: "deal_not_found", 
          dealId,
          hint: "This dealId does not exist in the connected Supabase environment. Verify Vercel env vars point to the intended Supabase project."
        } satisfies ProbeErr,
        { status: 404 }
      );
    }

    // Check if we have bank context
    if (!bankId && !deal.bank_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "bank_context_missing",
          dealId,
          hint: "Signed-in user has no bank context yet. Auto-provisioning should have created one - check getCurrentBankId() logs."
        } satisfies ProbeErr,
        { status: 400 }
      );
    }

    // 2) Tenant enforcement:
    // If we have a bankId from auth context:
    // - if deal.bank_id is set and mismatched -> 404 (don't leak existence across tenants)
    // - if deal.bank_id is null -> attach bankId (first-touch tenant binding)
    let ensured_bank: ProbeOk["ensured_bank"] = null;

    if (bankId) {
      if (deal.bank_id && deal.bank_id !== bankId) {
        return NextResponse.json(
          { ok: false, error: "deal_not_found", details: "bank_mismatch", dealId } satisfies ProbeErr,
          { status: 404 }
        );
      }

      if (!deal.bank_id) {
        const { error: uErr } = await sb.from("deals").update({ bank_id: bankId }).eq("id", dealId);
        if (uErr) {
          return NextResponse.json(
            { ok: false, error: "deal_bank_assign_failed", details: uErr.message, dealId } satisfies ProbeErr,
            { status: 500 }
          );
        }
        ensured_bank = { ok: true, bankId, updated: true };
        deal.bank_id = bankId;
      } else {
        ensured_bank = { ok: true, bankId: deal.bank_id, updated: false };
      }
    }

    // 3) Count missing documents
    const { count: missingDocs } = await sb
      .from("deal_document_requirements")
      .select("*", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "missing");

    // 4) Count open conditions
    const { count: openConditions } = await sb
      .from("deal_conditions")
      .select("*", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .in("status", ["pending", "in_progress"]);

    // 5) Risk flags (placeholder)
    const riskFlags: string[] = [];
    if (deal.risk_score && deal.risk_score > 70) riskFlags.push("High Risk Score");

    // 6) Legacy context payload (keep existing consumers happy)
    const context: DealContext = {
      dealId: deal.id,
      stage: (deal.stage as DealContext["stage"]) ?? "intake",
      borrower: {
        name: deal.borrower_name ?? "Unknown Borrower",
        entityType: deal.entity_type ?? "Unknown",
      },
      risk: {
        score: deal.risk_score ?? 0,
        flags: riskFlags,
      },
      completeness: {
        missingDocs: missingDocs ?? 0,
        openConditions: openConditions ?? 0,
      },
      permissions: {
        canApprove: true,
        canRequest: true,
        canShare: true,
      },
    };

    // 7) Add probe wrapper fields WITHOUT breaking legacy shape
    const probe: ProbeOk = {
      ok: true,
      deal: { id: deal.id, bank_id: deal.bank_id ?? null, created_at: (deal as any).created_at ?? null },
      ensured_bank,
      server_ts: new Date().toISOString(),
    };

    return NextResponse.json({ ...probe, ...context });
  } catch (e: any) {
    console.error("GET /api/deals/[dealId]/context error:", e);
    return NextResponse.json(
      { ok: false, error: "unhandled_error", details: String(e?.message ?? e) } satisfies ProbeErr,
      { status: 500 }
    );
  }
}
