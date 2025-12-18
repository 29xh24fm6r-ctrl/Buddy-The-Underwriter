import { supabaseAdmin } from "@/lib/supabase/admin";

type Program = "7A" | "504" | "EXPRESS" | "CAPLINES" | "OTHER";

const BASE_MILESTONES = [
  { code: "UPLOAD_CLOSING_PACKAGE", name: "Upload complete closing package", dueDays: 7 },
  { code: "DOC_RETENTION_CHECK", name: "Document retention checklist complete", dueDays: 14 },
  { code: "ANNUAL_REVIEW_SETUP", name: "Annual review cycle scheduled", dueDays: 30 },
  { code: "INSURANCE_TRACKING", name: "Insurance tracking verified", dueDays: 30 },
];

export async function ensureSbaLoanAndMilestones(args: {
  dealId: string;
  program: Program;
  closingDate?: string | null;
}) {
  const { data: existing, error: e1 } = await supabaseAdmin()
    .from("sba_loans")
    .select("*")
    .eq("deal_id", args.dealId)
    .maybeSingle() as any;

  if (e1) throw e1;

  const loan =
    existing ??
    (await supabaseAdmin()
      .from("sba_loans")
      .insert({
        deal_id: args.dealId,
        program: args.program,
        closing_date: args.closingDate ? args.closingDate : null,
        status: args.closingDate ? "CLOSED" : "PRE_CLOSE",
      } as any)
      .select("*")
      .single() as any).data;

  if (!loan) throw new Error("Failed to ensure sba_loans row");

  // Seed milestones idempotently
  const closingBase = args.closingDate ? new Date(args.closingDate) : new Date();

  for (const m of BASE_MILESTONES) {
    const due = new Date(closingBase.getTime() + m.dueDays * 24 * 60 * 60 * 1000);
    const { error } = await supabaseAdmin()
      .from("sba_milestones")
      .upsert(
        {
          sba_loan_id: loan.id,
          code: m.code,
          name: m.name,
          due_date: due.toISOString().slice(0, 10),
          status: "OPEN",
          evidence: {},
        } as any,
        { onConflict: "sba_loan_id,code" }
      ) as any;

    if (error) throw error;
  }

  return loan;
}
