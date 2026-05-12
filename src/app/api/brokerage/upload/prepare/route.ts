import "server-only";

import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSessionFromRequest } from "@/lib/brokerage/session";
import { checkConciergeRateLimit } from "@/lib/brokerage/rateLimits";

/**
 * POST /api/brokerage/upload/prepare
 *
 * SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.2 (hardened over PRODUCTIONIZATION-V1 §Phase 6).
 *
 *   1. Auth — requires `buddy_borrower_session` cookie.
 *   2. Rate limit — reuses the concierge limiter; abusive sessions / IPs
 *      get 429 + retry-after.
 *   3. Idempotency — if the borrower already has an unused, unexpired,
 *      not-revoked `brokerage_self_serve` link for this deal, return that
 *      row instead of minting a new token. Double-clicks and replays are
 *      no-ops.
 *   4. Supersede — when a NEW link is minted, prior unconsumed
 *      `brokerage_self_serve` rows for the same deal are marked
 *      `revoked_at = now()` so they can no longer be used. This means
 *      the borrower can only ever hold one live upload URL at a time.
 *   5. Audit — every outcome writes one `ai_events` row.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_EXPIRES_HOURS = 24;
const CHANNEL = "brokerage_self_serve";

async function logEvent(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  action: "link_minted" | "link_returned_idempotent" | "rate_limited",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from("ai_events").insert({
      deal_id: dealId,
      scope: "brokerage_upload",
      action,
      input_json: {},
      output_json: payload,
      confidence: 1,
      requires_human_review: false,
    });
  } catch (e) {
    console.warn(
      "[brokerage-upload-prepare] ai_events insert failed (non-fatal):",
      (e as Error)?.message ?? String(e),
    );
  }
}

export async function POST(): Promise<NextResponse> {
  const session = await getBorrowerSessionFromRequest();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "no_borrower_session" },
      { status: 401 },
    );
  }

  const rl = await checkConciergeRateLimit({ tokenHash: session.tokenHash });
  if (!rl.allowed) {
    const sb = supabaseAdmin();
    await logEvent(sb, session.deal_id, "rate_limited", {
      reason: rl.reason,
      retry_after_seconds: rl.retryAfterSeconds,
    });
    return NextResponse.json(
      { ok: false, error: "rate_limited", reason: rl.reason },
      {
        status: 429,
        headers: { "retry-after": String(rl.retryAfterSeconds) },
      },
    );
  }

  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();

  // Idempotency — look for an existing live brokerage_self_serve link for
  // this deal. "live" means: not consumed, not revoked, not expired.
  const { data: liveLinks } = await sb
    .from("borrower_portal_links")
    .select("token, expires_at, used_at, revoked_at")
    .eq("deal_id", session.deal_id)
    .eq("channel", CHANNEL)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);

  if (liveLinks && liveLinks.length > 0) {
    const live = liveLinks[0];
    await logEvent(sb, session.deal_id, "link_returned_idempotent", {
      token_tail: live.token.slice(-6),
    });
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
    return NextResponse.json({
      ok: true,
      dealId: session.deal_id,
      token: live.token,
      expiresAt: live.expires_at,
      uploadUrl: `${base}/upload/${live.token}`,
      idempotent: true,
    });
  }

  // Supersede: revoke any prior brokerage_self_serve rows that might be
  // hanging around (e.g. consumed but not revoked, or a stale unused row
  // older than the live window). This is the single-active-link rule.
  await sb
    .from("borrower_portal_links")
    .update({ revoked_at: nowIso })
    .eq("deal_id", session.deal_id)
    .eq("channel", CHANNEL)
    .is("revoked_at", null);

  // Mint the new link.
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(
    Date.now() + DEFAULT_EXPIRES_HOURS * 3600 * 1000,
  ).toISOString();

  const { data: inserted, error: insertErr } = await sb
    .from("borrower_portal_links")
    .insert({
      deal_id: session.deal_id,
      bank_id: session.bank_id,
      token,
      label: "Brokerage borrower upload",
      single_use: true,
      expires_at: expiresAt,
      channel: CHANNEL,
    })
    .select("token, deal_id, expires_at")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { ok: false, error: insertErr?.message ?? "create_link_failed" },
      { status: 500 },
    );
  }

  await logEvent(sb, session.deal_id, "link_minted", {
    token_tail: inserted.token.slice(-6),
    expires_at: inserted.expires_at,
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return NextResponse.json({
    ok: true,
    dealId: inserted.deal_id,
    token: inserted.token,
    expiresAt: inserted.expires_at,
    uploadUrl: `${base}/upload/${inserted.token}`,
    idempotent: false,
  });
}
