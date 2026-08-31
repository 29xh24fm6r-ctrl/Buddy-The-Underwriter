import "server-only";

import { clerkAuth } from "@/lib/auth/clerkServer";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDealLabel } from "@/lib/deals/dealLabel";
import { listBrokerageTeam } from "@/lib/brokerage/team";
import PipelineBoard, { type PipelineDeal } from "./PipelineBoard";

export const dynamic = "force-dynamic";

/**
 * /admin/brokerage/pipeline — the brokerage's book of business.
 *
 * This was a flat list of the eighty most recent deals: no stages, no owner,
 * no filters, no sign of which banks had the file. Everything needed to make
 * it a real board already existed in the database and was simply never read
 * — the 21-stage ladder, the owner column, the tasks with assignees, and the
 * deal→bank submission ledger. This page reads all four and hands them to
 * one client board.
 *
 * Still deliberately forked from the shared (app)/deals/page.tsx: that page
 * is tenant-agnostic code every bank client sees, and brokerage pipeline
 * semantics have no business leaking into it. Individual deals still open
 * the canonical cockpit for documents and underwriting.
 */

type SubmissionRow = {
  deal_id: string;
  lender_profile_id: string;
  status: string;
};

export default async function BrokeragePipelinePage() {
  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  // "Mine" has to mean the person looking at the board, not the first row of
  // the roster. Null when Clerk is unreachable; the filter hides itself then.
  const currentUserId = (await clerkAuth()).userId ?? null;

  const [{ data: dealRows, error: dealsError }, { data: submissions }, { data: tasks }, team] = await Promise.all([
    sb
      .from("deals")
      // loan_amount is the only amount column on deals. The page this
      // replaced selected a non-existent `amount`, so PostgREST rejected the
      // whole query and the catch-all `if (error) deals = []` rendered "No
      // deals in the pipeline" — a broken query and an empty book of business
      // look identical, which is how it survived. Hence dealsError below.
      .select(
        "id, display_name, nickname, borrower_name, name, loan_amount, state, product_type, " +
          "brokerage_stage, brokerage_stage_entered_at, brokerage_stage_owner_clerk_user_id, " +
          "intake_mode, crm_tracking_only, created_at, is_test",
      )
      .eq("bank_id", bankId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
    sb
      .from("crm_deal_lender_submissions")
      .select("deal_id, lender_profile_id, status")
      .eq("bank_id", bankId),
    sb
      .from("brokerage_tasks")
      .select("id, deal_id, title, due_at, assigned_to_clerk_user_id, status, priority")
      .eq("bank_id", bankId)
      .not("deal_id", "is", null)
      .in("status", ["open", "in_progress", "blocked"])
      .order("due_at", { ascending: true, nullsFirst: false }),
    listBrokerageTeam(bankId),
  ]);

  const submissionsByDeal = new Map<string, SubmissionRow[]>();
  for (const row of (submissions ?? []) as SubmissionRow[]) {
    submissionsByDeal.set(row.deal_id, [...(submissionsByDeal.get(row.deal_id) ?? []), row]);
  }

  // Tasks arrive due-date ascending, so the first one seen for a deal is the
  // one that matters next.
  const nextTaskByDeal = new Map<string, any>();
  for (const task of tasks ?? []) {
    if (!nextTaskByDeal.has(task.deal_id)) nextTaskByDeal.set(task.deal_id, task);
  }

  const deals: PipelineDeal[] = ((dealRows ?? []) as any[])
    .filter((d) => !d.is_test)
    .map((d) => {
      const label = resolveDealLabel({
        id: d.id,
        display_name: d.display_name ?? null,
        nickname: d.nickname ?? null,
        borrower_name: d.borrower_name ?? null,
        name: d.name ?? null,
      });
      const own = submissionsByDeal.get(d.id) ?? [];
      const task = nextTaskByDeal.get(d.id) ?? null;
      return {
        id: d.id,
        title: label.label,
        borrower: d.borrower_name ?? d.name ?? null,
        amount: Number(d.loan_amount ?? 0) || null,
        state: d.state ?? null,
        productType: d.product_type ?? null,
        stage: d.brokerage_stage ?? null,
        stageEnteredAt: d.brokerage_stage_entered_at ?? d.created_at ?? null,
        ownerClerkUserId: d.brokerage_stage_owner_clerk_user_id ?? null,
        intakeMode: d.intake_mode ?? (d.crm_tracking_only ? "tracking_only" : null),
        createdAt: d.created_at ?? null,
        banksSent: own.filter((s) => s.status !== "planned").length,
        banksReviewing: own.filter((s) => ["reviewing", "interested"].includes(s.status)).length,
        banksAdvanced: own.filter((s) => ["term_sheet", "approved", "closed"].includes(s.status)).length,
        banksDeclined: own.filter((s) => ["declined", "lost", "withdrawn"].includes(s.status)).length,
        nextTask: task ? { title: task.title, dueAt: task.due_at ?? null } : null,
      };
    });

  return (
    <PipelineBoard
      deals={deals}
      team={team}
      currentUserId={currentUserId}
      loadError={dealsError?.message ?? null}
    />
  );
}
