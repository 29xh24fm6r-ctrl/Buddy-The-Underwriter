import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildChecklistForLoanType, LoanType } from "@/lib/deals/checklistPresets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  loanType: LoanType;
  borrowerName?: string | null;
  borrowerEmail?: string | null;
  borrowerPhone?: string | null;
  autoSeed?: boolean; // default true
};

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Body | null;

  const loanType = body?.loanType;
  if (!loanType) return NextResponse.json({ ok: false, error: "Missing loanType" }, { status: 400 });

  if (!["CRE", "LOC", "TERM", "SBA_7A", "SBA_504"].includes(loanType)) {
    return NextResponse.json({ ok: false, error: "Invalid loanType" }, { status: 400 });
  }

  const sbaProgram = loanType === "SBA_7A" ? "7A" : loanType === "SBA_504" ? "504" : null;

  const { error: upErr } = await supabaseAdmin().from("deal_intake").upsert(
    {
      deal_id: dealId,
      loan_type: loanType,
      sba_program: sbaProgram,
      borrower_name: body?.borrowerName ?? null,
      borrower_email: body?.borrowerEmail ?? null,
      borrower_phone: body?.borrowerPhone ?? null,
    },
    { onConflict: "deal_id" }
  );

  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });

  const autoSeed = body?.autoSeed ?? true;
  if (autoSeed) {
    const rows = buildChecklistForLoanType(loanType).map((r) => ({
      deal_id: dealId,
      checklist_key: r.checklist_key,
      title: r.title,
      description: r.description ?? null,
      required: r.required,
    }));

    const { error: seedErr } = await supabaseAdmin()
      .from("deal_checklist_items")
      .upsert(rows, { onConflict: "deal_id,checklist_key" });

    if (seedErr) return NextResponse.json({ ok: false, error: seedErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
