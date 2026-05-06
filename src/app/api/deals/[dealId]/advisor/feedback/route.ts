/**
 * SPEC-10 — advisor signal feedback persistence.
 *
 * GET   /api/deals/[dealId]/advisor/feedback
 *       → { ok, feedback: AdvisorFeedbackRow[] }
 * POST  /api/deals/[dealId]/advisor/feedback
 *       Body: { signalKey, signalKind, signalSource, state, snoozedUntil?, reason? }
 *       → { ok, feedback: AdvisorFeedbackRow }
 *
 * Every mutation also emits a `buddy_signal_ledger` event:
 *   advisor_signal_acknowledged / _dismissed / _snoozed.
 *
 * Both verbs degrade gracefully if `buddy_advisor_feedback` is missing —
 * the client hook already mirrors to localStorage. The server returns
 * `{ ok: false, error: "table_missing" }` so the hook can fall through.
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const VALID_STATES = new Set(["acknowledged", "dismissed", "snoozed"]);

const SIGNAL_LEDGER_KIND: Record<string, string> = {
  acknowledged: "advisor_signal_acknowledged",
  dismissed: "advisor_signal_dismissed",
  snoozed: "advisor_signal_snoozed",
};

function isMissingTableError(message: string | null | undefined): boolean {
  if (!message) return false;
  // Postgres "relation does not exist" + Postgrest equivalents.
  return (
    /relation\s+"?buddy_advisor_feedback"?\s+does not exist/i.test(message) ||
    /could not find the table/i.test(message) ||
    /table\s+not\s+found/i.test(message)
  );
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { userId } = await clerkAuth().catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return NextResponse.json(
      { ok: false, error: "no_bank_context" },
      { status: 403 },
    );
  }

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  // SPEC-11: filter expired snoozes server-side. Active rows are:
  //   state != 'snoozed'
  //   OR snoozed_until IS NULL
  //   OR snoozed_until > now()
  // Postgrest doesn't support `OR` cleanly across mixed columns, so we
  // load all rows and filter in JS — the volume is bounded by per-deal
  // signal cardinality (small).
  const res = await (sb as any)
    .from("buddy_advisor_feedback")
    .select(
      "id, signal_key, signal_kind, signal_source, state, snoozed_until, reason, dismiss_count, last_dismissed_at, created_at, updated_at",
    )
    .eq("bank_id", bankId)
    .eq("deal_id", dealId)
    .eq("user_id", userId);

  if (res.error) {
    if (isMissingTableError(res.error.message)) {
      return NextResponse.json({ ok: false, error: "table_missing", feedback: [] });
    }
    return NextResponse.json(
      { ok: false, error: res.error.message, feedback: [] },
      { status: 500 },
    );
  }

  const now = Date.now();
  const active = (res.data ?? []).filter((row: any) => {
    if (row.state !== "snoozed") return true;
    if (!row.snoozed_until) return true;
    return new Date(row.snoozed_until).getTime() > now;
  });

  return NextResponse.json({ ok: true, feedback: active });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { userId } = await clerkAuth().catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return NextResponse.json(
      { ok: false, error: "no_bank_context" },
      { status: 403 },
    );
  }

  const { dealId } = await ctx.params;
  const body = await req.json().catch(() => null);

  const signalKey = String(body?.signalKey ?? "").trim();
  const signalKind = String(body?.signalKind ?? "").trim();
  const signalSource = String(body?.signalSource ?? "").trim();
  const state = String(body?.state ?? "").trim();
  const snoozedUntil = body?.snoozedUntil ? String(body.snoozedUntil) : null;
  const reason = body?.reason ? String(body.reason).trim() : null;

  if (!signalKey || !signalKind || !signalSource) {
    return NextResponse.json(
      { ok: false, error: "missing_signal_fields" },
      { status: 400 },
    );
  }
  if (!VALID_STATES.has(state)) {
    return NextResponse.json(
      { ok: false, error: "invalid_state" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // SPEC-11 — read existing row first so we can server-side track
  // dismiss_count + auto-snooze on the third dismissal.
  const REPEATED_DISMISS_THRESHOLD = 3;
  const REPEATED_DISMISS_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

  const existingRes = await (sb as any)
    .from("buddy_advisor_feedback")
    .select("id, dismiss_count, last_dismissed_at, state, snoozed_until")
    .eq("bank_id", bankId)
    .eq("deal_id", dealId)
    .eq("user_id", userId)
    .eq("signal_key", signalKey)
    .maybeSingle();

  if (existingRes.error && isMissingTableError(existingRes.error.message)) {
    return NextResponse.json({ ok: false, error: "table_missing" });
  }

  const previous = existingRes.data ?? null;
  const wasDismissed = state === "dismissed";
  const newDismissCount = wasDismissed
    ? (previous?.dismiss_count ?? 0) + 1
    : previous?.dismiss_count ?? 0;
  const lastDismissedAt = wasDismissed
    ? new Date().toISOString()
    : previous?.last_dismissed_at ?? null;

  // Auto-snooze: when the dismiss count crosses the threshold we
  // collapse the dismiss into a 7-day snooze, with reason recorded.
  let resolvedState = state;
  let resolvedSnoozedUntil = state === "snoozed" ? snoozedUntil : null;
  let resolvedReason = reason;
  if (wasDismissed && newDismissCount >= REPEATED_DISMISS_THRESHOLD) {
    resolvedState = "snoozed";
    resolvedSnoozedUntil = new Date(
      Date.now() + REPEATED_DISMISS_SNOOZE_MS,
    ).toISOString();
    resolvedReason = "repeated_dismissal";
  }

  const upsert = await (sb as any)
    .from("buddy_advisor_feedback")
    .upsert(
      {
        bank_id: bankId,
        deal_id: dealId,
        user_id: userId,
        signal_key: signalKey,
        signal_kind: signalKind,
        signal_source: signalSource,
        state: resolvedState,
        snoozed_until: resolvedSnoozedUntil,
        reason: resolvedReason,
        dismiss_count: newDismissCount,
        last_dismissed_at: lastDismissedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "bank_id,deal_id,user_id,signal_key" },
    )
    .select(
      "id, signal_key, signal_kind, signal_source, state, snoozed_until, reason, dismiss_count, last_dismissed_at, created_at, updated_at",
    )
    .maybeSingle();

  if (upsert.error) {
    if (isMissingTableError(upsert.error.message)) {
      return NextResponse.json({ ok: false, error: "table_missing" });
    }
    return NextResponse.json(
      { ok: false, error: upsert.error.message },
      { status: 500 },
    );
  }

  // Mirror to buddy_signal_ledger so observability dashboards see the
  // event family even when the feedback table is consulted directly.
  try {
    await (sb as any).from("buddy_signal_ledger").insert({
      bank_id: bankId,
      deal_id: dealId,
      type:
        SIGNAL_LEDGER_KIND[resolvedState] ?? "advisor_signal_feedback_updated",
      source: "stage_cockpit",
      payload: {
        signalKey,
        signalKind,
        signalSource,
        state: resolvedState,
        snoozedUntil: resolvedSnoozedUntil,
        reason: resolvedReason,
        dismissCount: newDismissCount,
        autoSnoozedFromDismissal:
          wasDismissed && resolvedState === "snoozed",
      },
    });
  } catch {
    // ledger failure is non-fatal — feedback row is the canonical state.
  }

  return NextResponse.json({ ok: true, feedback: upsert.data ?? null });
}
