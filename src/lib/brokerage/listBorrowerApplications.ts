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

/**
 * SPEC-BORROWER-APPLICATION-DISCOVERY-1 — thrown when the deals/deal_status
 * lookup itself fails (schema drift, connection error, etc.), as distinct
 * from a borrower genuinely having zero applications. Callers MUST NOT
 * catch this and treat it as an empty result — see this file's own
 * incident note below for why that distinction matters.
 */
export class ApplicationLookupError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message);
    this.name = "ApplicationLookupError";
  }
}

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

/**
 * SPEC-BORROWER-APPLICATION-DISCOVERY-1 — INCIDENT (found live, 2026-08-12):
 * this query used to select `deals.loan_purpose`, a column that does not
 * exist on `deals` in production (it lives on `brokerage_leads`,
 * `deal_loan_requests`, `loan_requests`, and `borrower_applications`
 * instead — none of which this function currently joins). Every call
 * 400'd, and the old code path folded that failure into the SAME return
 * value as "borrower genuinely has zero applications" ([]) — so a real
 * borrower with real applications could be told "no applications found."
 * A database/query failure and a legitimate empty result are different
 * states and must never be conflated: this now throws
 * ApplicationLookupError on query failure so callers can't silently
 * misrepresent one as the other, while a genuine zero-row result still
 * returns [] exactly as before.
 */
export async function listBorrowerApplications(args: {
  email: string;
  bankId: string;
}): Promise<BorrowerApplication[]> {
  const sb = supabaseAdmin();
  const email = args.email.toLowerCase().trim();

  const { data: deals, error: dealsErr } = await sb
    .from("deals")
    .select("id, display_name, name, updated_at")
    .eq("bank_id", args.bankId)
    .eq("borrower_email", email)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (dealsErr) {
    console.error("[listBorrowerApplications] deals query failed:", dealsErr.message);
    throw new ApplicationLookupError(
      "Failed to look up borrower applications",
      dealsErr,
    );
  }

  if (!deals || deals.length === 0) {
    // Genuine empty result — the query itself succeeded.
    return [];
  }

  const dealIds = deals.map((d: any) => d.id);

  const { data: statusRows, error: statusErr } = await sb
    .from("deal_status")
    .select("deal_id, stage")
    .in("deal_id", dealIds);

  if (statusErr) {
    console.error("[listBorrowerApplications] deal_status query failed:", statusErr.message);
    throw new ApplicationLookupError(
      "Failed to look up borrower application statuses",
      statusErr,
    );
  }

  const stageByDealId = new Map<string, string>();
  for (const row of statusRows ?? []) {
    stageByDealId.set((row as any).deal_id, (row as any).stage);
  }

  const applications = (deals as any[]).map((d) => {
    const stage = stageByDealId.get(d.id) ?? null;
    return {
      id: d.id,
      businessName: d.display_name ?? d.name ?? null,
      // loan_purpose does not exist on `deals` (see incident note above) —
      // never selected, always null here. Do not reintroduce it without a
      // real join to one of the tables that actually has the column.
      loanPurpose: null,
      status: stage,
      statusLabel: labelForStage(stage),
      lastActivityAt: d.updated_at ?? null,
      bucket: bucketForStage(stage),
    };
  });

  return collapseBlankDuplicates(applications);
}

/**
 * SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1-HOTFIX — safe DISPLAY-layer
 * dedup, applied here (the single source both the OTP-verification dedup
 * check and the Application Chooser UI both call) so both stay
 * consistent. Confirmed in production: repeated concierge/chat
 * interactions from a fresh session (see the concierge route's own fix,
 * same spec) previously left a real borrower with many literally
 * unmodified "New borrower inquiry" deals — never a real application,
 * just abandoned session artifacts.
 *
 * Deliberately narrow: only collapses deals whose display name is STILL
 * the exact literal placeholder ("New borrower inquiry" — set once at
 * deal creation and never touched again unless the borrower actually
 * enters business info, which updates it elsewhere). Anything with a
 * real, borrower-entered name is never touched, collapsed, or hidden —
 * this never hides a legitimate application. Rows are never deleted here;
 * this only affects what this function returns to its callers.
 */
const BLANK_PLACEHOLDER_NAME = "New borrower inquiry";

export function collapseBlankDuplicates(
  applications: BorrowerApplication[],
): BorrowerApplication[] {
  const blank = applications.filter((a) => a.businessName === BLANK_PLACEHOLDER_NAME);
  if (blank.length <= 1) return applications;

  // Already sorted by updated_at desc from the query — keep the first
  // (most recent) blank one, drop the rest.
  const keepId = blank[0].id;
  return applications.filter(
    (a) => a.businessName !== BLANK_PLACEHOLDER_NAME || a.id === keepId,
  );
}
