/**
 * SPEC-M2 BEAT-METRICS-1 — the five program "beat condition" metrics.
 *
 * Reuses the existing (previously unused) brokerage_conversion_events
 * writer (logConversionEvent, ./conversionFunnel.ts) for four
 * event-shaped metrics, plus a new dedicated ledger (borrower_fact_requests)
 * for repeat_ask_count, which needs per-fact-key granularity a generic
 * event log doesn't give you.
 *
 * `sb` is a required parameter on every function here, never defaulted to
 * supabaseAdmin() — same convention as conversionFunnel.ts's own exports.
 * Callers already holding a client (route handlers, generateMissingItemsFollowup)
 * pass it through; this also keeps every function trivially testable against
 * the repo's in-memory fake-Supabase convention with no env-var dependency.
 *
 * Honest-coverage note: emitReadinessReadRendered and recordFactRequest
 * have no real call site yet — the experiences that would call them
 * (M3 Glass Box, M5 Conversational Intake) don't exist. They're defined
 * and tested now so those specs wire into a contract that's already
 * proven, not invented after the fact. emitFirstInteraction,
 * emitFormlessStart, and emitDocRequestRound DO have real call sites
 * wired in this spec — see session.ts and generateMissingItemsFollowup.ts.
 *
 * No "server-only" marker — matches conversionFunnel.ts (this module wraps
 * and extends), which is a plain data-writing helper, not a secrets
 * boundary. Keeps this file testable with the repo's ordinary
 * createRequire pattern, no mockServerOnly needed.
 */
import { logConversionEvent } from "./conversionFunnel";

type SB = { from: (t: string) => any };

/**
 * t0 for ttfa_minutes — first document/utterance for a deal. Wired today
 * at new-borrower-session creation (the earliest real signal available
 * pre-M3); M3 will additionally call emitReadinessReadRendered as t1.
 */
export async function emitFirstInteraction(dealId: string, sb: SB): Promise<void> {
  await logConversionEvent({ dealId, eventType: "first_interaction" }, sb);
}

/**
 * t1 for ttfa_minutes — the borrower's readiness read actually rendered.
 * No caller yet; SPEC-M3 GLASS-BOX-1 calls this when it ships.
 */
export async function emitReadinessReadRendered(dealId: string, sb: SB): Promise<void> {
  await logConversionEvent({ dealId, eventType: "readiness_read_rendered" }, sb);
}

/**
 * formless_start — did this deal begin without a form field? Always false
 * today (no conversational intake exists); SPEC-M5 CONVERSATIONAL-INTAKE-1
 * will pass true from its entry point.
 */
export async function emitFormlessStart(dealId: string, formless: boolean, sb: SB): Promise<void> {
  await logConversionEvent({ dealId, eventType: "formless_start", metadata: { formless } }, sb);
}

/**
 * repeat_ask_count's raw signal — one row per (deal, fact) request. The
 * rollup view (v_beat_repeat_ask_by_deal) groups these and surfaces any
 * fact_key requested more than once per deal. No real caller yet — see
 * module doc comment; SPEC-M5's interviewer records every question it asks
 * here, and must never ask a key the fact registry already shows answered
 * (enforced by the synthetic-run regression harness, scripts/synth-borrower-e2e.ts).
 */
export async function recordFactRequest(
  dealId: string,
  factKey: string,
  source: string,
  sb: SB,
): Promise<void> {
  await sb.from("borrower_fact_requests").insert({ deal_id: dealId, fact_key: factKey, source });
}

/**
 * doc_request_rounds — one call per distinct request batch dispatched to
 * a borrower pre-submission. Wired into generateMissingItemsFollowup:
 * proxy signal is "a batch of borrower-request drafts was created," not
 * "a batch was sent" — see that module's doc comment for the known
 * over-count risk (a banker can regenerate drafts without sending). Also
 * wired into SPEC-M4 FIX-CARDS-1's fix-cards route, which passes
 * `extraMetadata: { gapKeys }` so it can dedupe against the same gap set
 * on a later call (see that route's own dedup logic).
 */
export async function emitDocRequestRound(
  dealId: string,
  itemCount: number,
  sb: SB,
  extraMetadata?: Record<string, unknown>,
): Promise<void> {
  await logConversionEvent(
    { dealId, eventType: "doc_request_round", metadata: { itemCount, ...extraMetadata } },
    sb,
  );
}

/**
 * lender_followup_count — manual banker entry (no automated signal exists:
 * nothing in this system observes a lender's own follow-up questions).
 * Called from the deal activity POST action, src/app/api/deals/[dealId]/activity/route.ts.
 */
export async function emitLenderFollowup(
  dealId: string,
  note: string | undefined,
  sb: SB,
): Promise<void> {
  await logConversionEvent(
    { dealId, eventType: "lender_followup", metadata: note ? { note } : {} },
    sb,
  );
}
