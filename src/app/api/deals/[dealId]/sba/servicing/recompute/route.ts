import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureSbaLoanAndMilestones } from "@/lib/sba/servicing/seedMilestones";
import { recomputeSbaServicing } from "@/lib/sba/servicing/evaluateServicing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const program = (body?.program ?? "7A") as any;
    const closing_date = (body?.closing_date ?? null) as string | null;

    await ensureSbaLoanAndMilestones({ dealId, program, closingDate: closing_date });
    const result = await recomputeSbaServicing(dealId);

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;

    const { data: loan, error: e1 } = await supabaseAdmin().from("sba_loans").select("*").eq("deal_id", dealId).maybeSingle() as any;
    if (e1) throw e1;

    if (!loan) return NextResponse.json({ ok: true, loan: null, milestones: [], summary: null });

    const { data: milestones, error: e2 } = await supabaseAdmin()
      .from("sba_milestones")
      .select("*")
      .eq("sba_loan_id", loan.id)
      .order("due_date", { ascending: true }) as any;

    if (e2) throw e2;

    const summary = {
      open: (milestones ?? []).filter((m: any) => m.status === "OPEN").length,
      overdue: (milestones ?? []).filter((m: any) => m.status === "OVERDUE").length,
      completed: (milestones ?? []).filter((m: any) => m.status === "COMPLETED").length,
    };

    return NextResponse.json({ ok: true, loan, milestones: milestones ?? [], summary });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
