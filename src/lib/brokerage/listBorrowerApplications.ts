import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Lists a verified email's existing deals at a bank, for the "Welcome
 * back" application chooser.
 *
 * STATUS TAXONOMY — investigated, not guessed (see
 * READINESS_SCORE_IMPLEMENTATION_REPORT-adjacent investigation notes).
 * This codebase has more than one deal-stage concept:
 *   - `deals.stage` / `deals.status` — free text, no CHECK constraint, no
 *     closed enum. Not safe to bucket against.
 *   - `deals.brokerage_stage` — a newer, richer 21-value pipeline enum
 *     (intake..funded/post_close/on_hold/withdrawn/declined/lost), but its
 *     own migration explicitly documents it as the *brokerage-facing*
 *     pipeline (banker/ops), not written for borrower consumption.
 *   - `deal_status.stage` — a separate table, an 8-value closed enum
 *     (`DealStage` in src/lib/deals/status.ts), and is explicitly
 *     documented in the codebase's own migration comments as "a separate
 *     borrower-facing enum." This is the one used here.
 *
 * `deal_status.stage` values: intake | docs_in_progress | analysis |
 * underwriting | conditional_approval | closing | funded | declined.
 *
 * Bucket mapping (explicit, closed-set — anything outside this list is
 * "unknown", never silently classified):
 *   active:    intake, docs_in_progress, analysis, underwriting,
 *              conditional_approval, closing
 *   completed: funded
 *   previous:  declined  (NOT "completed" — a decline is a terminal
 *              negative outcome, not a successful completion; surfaced in
 *              its own bucket so the UI can label it accordingly rather
 *              than implying success)
 *   unknown:   no deal_status row, or any stage value outside the above
 *              (schema drift, legacy data, a future stage not yet mapped
 *              here) — never guessed into active/completed/previous.
 */

export type ApplicationBucket = "active" | "completed" | "previous" | "unknown";

export type BorrowerApplication = {
  id: string;
  businessName: string | null;
  loanPurpose: string | null;
  status: string | null;
  statusLabel: string;
  lastActivityAt: string | null;
  bucket: ApplicationBucket;
};

const ACTIVE_STAGES = new Set([
  "intake",
  "docs_in_progress",
  "analysis",
  "underwriting",
  "conditional_approval",
  "closing",
]);
const COMPLETED_STAGES = new Set(["funded"]);
const PREVIOUS_STAGES = new Set(["declined"]);

const STAGE_LABELS: Record<string, string> = {
  intake: "Getting started",
  docs_in_progress: "Documents in progress",
  analysis: "Under analysis",
  underwriting: "In underwriting",
  conditional_approval: "Conditionally approved",
  closing: "Closing",
  funded: "Funded",
  declined: "Declined",
};

export function bucketForStage(stage: string | null | undefined): ApplicationBucket {
  if (!stage) return "unknown";
  if (ACTIVE_STAGES.has(stage)) return "active";
  if (COMPLETED_STAGES.has(stage)) return "completed";
  if (PREVIOUS_STAGES.has(stage)) return "previous";
  return "unknown";
}

export function labelForStage(stage: string | null | undefined): string {
  if (!stage) return "Status unavailable";
  return STAGE_LABELS[stage] ?? "Status unavailable";
}

export async function listBorrowerApplications(args: {
  email: string;
  bankId: string;
}): Promise<BorrowerApplication[]> {
  const sb = supabaseAdmin();
  const email = args.email.toLowerCase().trim();

  const { data: deals, error: dealsErr } = await sb
    .from("deals")
    .select("id, display_name, name, loan_purpose, updated_at")
    .eq("bank_id", args.bankId)
    .eq("borrower_email", email)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (dealsErr || !deals || deals.length === 0) {
    if (dealsErr) {
      console.error("[listBorrowerApplications] deals query failed:", dealsErr.message);
    }
    return [];
  }

  const dealIds = deals.map((d: any) => d.id);

  const { data: statusRows, error: statusErr } = await sb
    .from("deal_status")
    .select("deal_id, stage")
    .in("deal_id", dealIds);

  if (statusErr) {
    console.error("[listBorrowerApplications] deal_status query failed:", statusErr.message);
  }

  const stageByDealId = new Map<string, string>();
  for (const row of statusRows ?? []) {
    stageByDealId.set((row as any).deal_id, (row as any).stage);
  }

  return (deals as any[]).map((d) => {
    const stage = stageByDealId.get(d.id) ?? null;
    return {
      id: d.id,
      businessName: d.display_name ?? d.name ?? null,
      loanPurpose: d.loan_purpose ?? null,
      status: stage,
      statusLabel: labelForStage(stage),
      lastActivityAt: d.updated_at ?? null,
      bucket: bucketForStage(stage),
    };
  });
}
