/**
 * Spread-job document re-extraction budget.
 *
 * The spreads processor re-runs fact extraction on every active financial
 * document before it renders. With Gemini-primary extraction each document
 * costs 5–50 s, and the worker tick runs under a 300 s Vercel `maxDuration`.
 * A deal with nine tax returns and statements blew through that serially: the
 * invocation was killed mid-loop, no completion row was ever written, and the
 * observer re-queued the job every ten minutes into the same wall.
 *
 * These helpers are pure so the budget/resume logic is unit-testable without
 * the processor's server-only imports. The processor records the ids it has
 * finished in `meta.extract_progress` when it runs out of budget and re-queues
 * itself; the next lease resumes with the remaining documents.
 */

export const DEFAULT_EXTRACTION_BUDGET_MS = 150_000;

/** Document types the spreads processor re-extracts before rendering. */
export const EXTRACTABLE_DOC_TYPES: ReadonlySet<string> = new Set([
  "FINANCIAL_STATEMENT", "INCOME_STATEMENT", "OPERATING_STATEMENT",
  "BALANCE_SHEET", "RENT_ROLL",
  "IRS_1065", "IRS_1120", "IRS_1120S", "IRS_BUSINESS",
  "IRS_1040", "IRS_PERSONAL", "K1",
  "BUSINESS_TAX_RETURN", "TAX_RETURN", "PERSONAL_TAX_RETURN",
  "PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413",
  "TERM_SHEET", "LOI", "CLOSING_STATEMENT",
  "APPRAISAL", "COLLATERAL_SCHEDULE",
]);

export type ExtractProgress = {
  /** ISO timestamp of the lease that started this extraction cycle. */
  cycle: string;
  /** Document ids whose extraction already ran in this cycle. */
  done: string[];
  /** How many times the job has re-queued itself to continue extraction. */
  resumes: number;
};

export type ExtractableDoc = {
  id: string;
  docType: string;
};

export type ExtractionPlan = {
  /** Every active document the processor would extract, in queue order. */
  extractable: ExtractableDoc[];
  /** Documents still to extract in this lease. */
  remaining: ExtractableDoc[];
  /** Document ids already extracted in a previous lease of the same cycle. */
  done: string[];
  progress: ExtractProgress | null;
};

export function resolveExtractionBudgetMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.SPREAD_EXTRACTION_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EXTRACTION_BUDGET_MS;
}

export function readExtractProgress(meta: unknown): ExtractProgress | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>).extract_progress;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const done = Array.isArray(rec.done)
    ? rec.done.filter((d): d is string => typeof d === "string" && d.length > 0)
    : [];
  const cycle = typeof rec.cycle === "string" && rec.cycle ? rec.cycle : null;
  if (!cycle) return null;
  const resumes = typeof rec.resumes === "number" && Number.isFinite(rec.resumes)
    ? rec.resumes
    : 0;
  return { cycle, done, resumes };
}

export function resolveExtractableDocType(doc: {
  canonical_type?: string | null;
  ai_doc_type?: string | null;
  document_type?: string | null;
}): string | null {
  const docType = String(doc.canonical_type ?? doc.ai_doc_type ?? doc.document_type ?? "")
    .toUpperCase();
  if (!docType || !EXTRACTABLE_DOC_TYPES.has(docType)) return null;
  return docType;
}

/**
 * Decide which documents this lease must extract. Documents recorded as done
 * in `meta.extract_progress` (from an earlier lease of the same job) are
 * skipped; anything else is queued in the order the caller supplied.
 */
export function planExtraction(args: {
  activeDocs: Array<{
    id: string | number;
    canonical_type?: string | null;
    ai_doc_type?: string | null;
    document_type?: string | null;
  }>;
  meta: unknown;
}): ExtractionPlan {
  const progress = readExtractProgress(args.meta);
  const extractable: ExtractableDoc[] = [];
  for (const doc of args.activeDocs) {
    const docType = resolveExtractableDocType(doc);
    if (!docType) continue;
    extractable.push({ id: String(doc.id), docType });
  }
  const extractableIds = new Set(extractable.map((d) => d.id));
  // Only count prior progress for documents that are still active.
  const done = (progress?.done ?? []).filter((id) => extractableIds.has(id));
  const doneSet = new Set(done);
  const remaining = extractable.filter((d) => !doneSet.has(d.id));
  return { extractable, remaining, done, progress };
}

/**
 * Absolute epoch-ms after which no further document extraction may start.
 * The per-job budget always applies; a caller-supplied deadline (the worker
 * tick's own maxDuration horizon) can only tighten it.
 */
export function resolveExtractionDeadline(args: {
  startedAt: number;
  budgetMs: number;
  deadlineAt?: number | null;
}): number {
  const byBudget = args.startedAt + args.budgetMs;
  if (typeof args.deadlineAt === "number" && Number.isFinite(args.deadlineAt)) {
    return Math.min(byBudget, args.deadlineAt);
  }
  return byBudget;
}

/**
 * Whether to stop before extracting the document at `index`. The first
 * document of a lease always runs so a job can never stall without progress.
 */
export function shouldDeferExtraction(args: {
  index: number;
  now: number;
  deadline: number;
}): boolean {
  return args.index > 0 && args.now >= args.deadline;
}

export function nextExtractProgress(args: {
  prior: ExtractProgress | null;
  cycleStartedAt: number;
  done: string[];
}): ExtractProgress {
  return {
    cycle: args.prior?.cycle ?? new Date(args.cycleStartedAt).toISOString(),
    done: Array.from(new Set(args.done)),
    resumes: (args.prior?.resumes ?? 0) + 1,
  };
}
