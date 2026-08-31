/**
 * Board columns for the brokerage pipeline.
 *
 * BROKERAGE_STAGES has 21 entries because it models the audit trail — every
 * distinct state a deal can be recorded in. A board with 21 columns is not a
 * board, so this collapses them into the seven groups a broker actually
 * thinks in, without touching the underlying stage machine: the column is a
 * view of the stage, never a second source of truth for it.
 *
 * Deliberately free of `import "server-only"` (unlike ./stages) so the board
 * client component and the server page that feeds it share one definition
 * rather than keeping two lists in sync.
 */

export type BoardColumnId =
  | "qualifying"
  | "packaging"
  | "out_to_banks"
  | "term_sheet"
  | "closing"
  | "funded"
  | "parked";

export type BoardColumn = {
  id: BoardColumnId;
  label: string;
  /** What a deal in this column is waiting on, shown when the column is empty. */
  emptyHint: string;
  stages: readonly string[];
  /** Days in one stage after which a deal in this column is stalled. */
  stallDays: number;
};

export const BOARD_COLUMNS: readonly BoardColumn[] = [
  {
    id: "qualifying",
    label: "Qualifying",
    emptyHint: "New deals land here.",
    stages: ["intake", "discovery", "qualification", "engagement"],
    stallDays: 7,
  },
  {
    id: "packaging",
    label: "Packaging",
    emptyHint: "Deals collecting documents and being spread.",
    stages: ["application", "document_collection", "financial_analysis", "packaging"],
    stallDays: 14,
  },
  {
    id: "out_to_banks",
    label: "Out to banks",
    emptyHint: "Deals you have shared with lenders.",
    stages: ["lender_strategy", "submitted", "lender_review"],
    stallDays: 10,
  },
  {
    id: "term_sheet",
    label: "Term sheet",
    emptyHint: "Deals with an offer on the table.",
    stages: ["term_sheet", "underwriting"],
    stallDays: 21,
  },
  {
    id: "closing",
    label: "Closing",
    emptyHint: "Deals working through conditions.",
    stages: ["commitment", "closing"],
    stallDays: 30,
  },
  {
    id: "funded",
    label: "Funded",
    emptyHint: "Closed deals.",
    stages: ["funded", "post_close"],
    stallDays: 90,
  },
  {
    id: "parked",
    label: "Parked",
    emptyHint: "Nothing on hold, withdrawn, or lost.",
    stages: ["on_hold", "withdrawn", "declined", "lost"],
    stallDays: 365,
  },
];

const COLUMN_BY_STAGE = new Map<string, BoardColumnId>();
for (const column of BOARD_COLUMNS) {
  for (const stage of column.stages) COLUMN_BY_STAGE.set(stage, column.id);
}

/**
 * A deal with no brokerage_stage set is not hidden — it lands in Qualifying,
 * which is where an unstaged deal genuinely is. 40 of the 41 deals in
 * production had no stage, and a board that dropped them would show an empty
 * pipeline over a full book of business.
 */
export function columnForStage(stage: string | null | undefined): BoardColumnId {
  if (!stage) return "qualifying";
  return COLUMN_BY_STAGE.get(stage) ?? "qualifying";
}

export function isParked(stage: string | null | undefined): boolean {
  return columnForStage(stage) === "parked";
}

export function stallDaysForStage(stage: string | null | undefined): number {
  const id = columnForStage(stage);
  return BOARD_COLUMNS.find((c) => c.id === id)?.stallDays ?? 14;
}

/** Whole days since the deal entered its current stage; null when unknown. */
export function daysInStage(stageEnteredAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!stageEnteredAt) return null;
  const entered = new Date(stageEnteredAt).getTime();
  if (!Number.isFinite(entered)) return null;
  return Math.max(0, Math.floor((now.getTime() - entered) / 86_400_000));
}

/**
 * Stalled means "sitting in one stage longer than that part of the process
 * should take". Parked deals are never stalled — they are parked on purpose.
 */
export function isStalled(
  stage: string | null | undefined,
  stageEnteredAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (isParked(stage)) return false;
  const age = daysInStage(stageEnteredAt, now);
  return age !== null && age > stallDaysForStage(stage);
}

export const STAGE_LABELS: Record<string, string> = {
  intake: "Intake",
  discovery: "Discovery",
  qualification: "Qualification",
  engagement: "Engagement",
  application: "Application",
  document_collection: "Document collection",
  financial_analysis: "Financial analysis",
  packaging: "Packaging",
  lender_strategy: "Lender strategy",
  submitted: "Submitted",
  lender_review: "Lender review",
  term_sheet: "Term sheet",
  underwriting: "Underwriting",
  commitment: "Commitment",
  closing: "Closing",
  funded: "Funded",
  post_close: "Post-close",
  on_hold: "On hold",
  withdrawn: "Withdrawn",
  declined: "Declined",
  lost: "Lost",
};

export const INTAKE_MODE_LABELS: Record<string, string> = {
  self_sourced: "Self-sourced",
  referred: "Referred",
  inbound_portal: "Inbound",
  tracking_only: "Tracking only",
};
