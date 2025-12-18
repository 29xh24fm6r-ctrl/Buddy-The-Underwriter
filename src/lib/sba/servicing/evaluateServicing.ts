// src/lib/sba/servicing/evaluateServicing.ts

import { supabaseAdmin } from "@/lib/supabase/admin";

type SbaLoanRow = {
  id: string;
  deal_id: string;
};

type SbaMilestoneRow = {
  id: string;
  sba_loan_id: string;
  status: string | null;
  due_date: string | null; // expected: 'YYYY-MM-DD' or ISO string
  last_evaluated_at?: string | null;
  updated_at?: string | null;
};

function parseDueDate(due: string | null): Date | null {
  if (!due) return null;

  // If it's a date-only string (YYYY-MM-DD), normalize to midnight UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const dt = new Date(`${due}T00:00:00.000Z`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // Otherwise, try as ISO/date-time
  const dt = new Date(due);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Deterministic servicing recompute:
 * - Reads sba_loans row for deal
 * - Reads sba_milestones
 * - Marks milestones OVERDUE when past due and not completed
 */
export async function recomputeSbaServicing(dealId: string) {
  const sb = supabaseAdmin() as any;

  // 1) Load SBA loan row
  const { data: loan, error: e1 } = await sb
    .from("sba_loans")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (e1) throw e1;

  if (!loan) {
    return { ok: true, skipped: true, reason: "no sba_loans row" };
  }

  const loanRow = loan as SbaLoanRow;

  // 2) Load milestones
  const { data: milestones, error: e2 } = await sb
    .from("sba_milestones")
    .select("*")
    .eq("sba_loan_id", loanRow.id);

  if (e2) throw e2;

  const rows = (milestones ?? []) as SbaMilestoneRow[];

  const now = new Date();
  let updated = 0;

  for (const m of rows) {
    const due = parseDueDate(m.due_date);

    const status = (m.status ?? "").toUpperCase();
    const isCompleted = status === "COMPLETED";
    const isWaived = status === "WAIVED";
    const isClosed = isCompleted || isWaived;

    const isOverdue =
      !!due && !isClosed && due.getTime() < now.getTime();

    if (!isOverdue) {
      // Still stamp last_evaluated_at for audit/telemetry if you want (optional).
      // Keep it cheap: skip writes unless you need them.
      continue;
    }

    const patch = {
      status: "OVERDUE",
      last_evaluated_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const { error: e3 } = await sb
      .from("sba_milestones")
      .update(patch as any)
      .eq("id", m.id);

    if (e3) throw e3;

    updated += 1;
  }

  return { ok: true, updated };
}
