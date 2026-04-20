import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = Promise<{ dealId: string }>;

interface CashflowRowBody {
  entity_id: string;
  w2_salary?: number;
  other_personal_income?: number;
  mortgage_payment?: number;
  auto_payments?: number;
  student_loans?: number;
  credit_card_minimums?: number;
  other_personal_debt?: number;
  personal_income_notes?: string;
  personal_debt_notes?: string;
}

// ─── GET — per-deal guarantor cashflow (only 20%+ owners) ────────────────────

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    const [{ data: entities }, { data: interests }, { data: cashflows }] =
      await Promise.all([
        sb
          .from("deal_ownership_entities")
          .select("id, display_name, entity_type")
          .eq("deal_id", dealId),
        sb
          .from("deal_ownership_interests")
          .select("owner_entity_id, ownership_pct")
          .eq("deal_id", dealId),
        sb
          .from("buddy_guarantor_cashflow")
          .select("*")
          .eq("deal_id", dealId),
      ]);

    const rows = (entities ?? [])
      .map((e: { id: string; display_name: string | null; entity_type: string | null }) => {
        const interest = (interests ?? []).find(
          (i: { owner_entity_id: string; ownership_pct: number | null }) =>
            i.owner_entity_id === e.id,
        );
        const ownershipPct = Number(interest?.ownership_pct ?? 0);
        const cf = (cashflows ?? []).find(
          (c: { entity_id: string }) => c.entity_id === e.id,
        );
        return {
          entity_id: e.id,
          display_name: e.display_name,
          entity_type: e.entity_type,
          ownership_pct: ownershipPct,
          w2_salary: Number(cf?.w2_salary ?? 0),
          other_personal_income: Number(cf?.other_personal_income ?? 0),
          personal_income_notes: cf?.personal_income_notes ?? "",
          mortgage_payment: Number(cf?.mortgage_payment ?? 0),
          auto_payments: Number(cf?.auto_payments ?? 0),
          student_loans: Number(cf?.student_loans ?? 0),
          credit_card_minimums: Number(cf?.credit_card_minimums ?? 0),
          other_personal_debt: Number(cf?.other_personal_debt ?? 0),
          personal_debt_notes: cf?.personal_debt_notes ?? "",
        };
      })
      .filter((r) => r.ownership_pct >= 20);

    return NextResponse.json({ ok: true, guarantors: rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ─── PUT — upsert per-deal guarantor cashflow rows ───────────────────────────

export async function PUT(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: "Request body must be an array." },
        { status: 400 },
      );
    }

    const rows = body as CashflowRowBody[];
    const sb = supabaseAdmin();

    const upsertData = rows
      .filter((r) => typeof r.entity_id === "string" && r.entity_id.length > 0)
      .map((r) => ({
        deal_id: dealId,
        entity_id: r.entity_id,
        w2_salary: r.w2_salary ?? 0,
        other_personal_income: r.other_personal_income ?? 0,
        mortgage_payment: r.mortgage_payment ?? 0,
        auto_payments: r.auto_payments ?? 0,
        student_loans: r.student_loans ?? 0,
        credit_card_minimums: r.credit_card_minimums ?? 0,
        other_personal_debt: r.other_personal_debt ?? 0,
        personal_income_notes: r.personal_income_notes ?? null,
        personal_debt_notes: r.personal_debt_notes ?? null,
        updated_at: new Date().toISOString(),
      }));

    if (upsertData.length === 0) {
      return NextResponse.json({ ok: true, count: 0 });
    }

    const { error } = await sb
      .from("buddy_guarantor_cashflow")
      .upsert(upsertData, { onConflict: "deal_id,entity_id" });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, count: upsertData.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
