// Policy mitigants umbrella dispatcher.
//
// Consolidates the prior `/policy/mitigants/list` (GET), `/policy/mitigants/
// set-status` (POST), and `/policy/mitigants/sync` (POST) sibling routes
// into this single endpoint to reduce Vercel route-manifest pressure
// (post-2026-05-06 too_many_routes incident — the project is pinned near
// the 2048 deploy-route cap; see
// specs/platform/SPEC-2026-05-vercel-route-count-reduction.md).
//
// Auth: every verb resolves a Clerk session, canonical profile actor, and
// explicit deal-bank ownership through resolveDealApiContext().
//
// Wire shape:
//   GET  /policy/mitigants                          → list mitigants
//   POST /policy/mitigants  body: { action: "sync", actions: [...] }
//   POST /policy/mitigants  body: { action: "set-status", mitigant_key,
//                                   status, note? }
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDealApiContext } from "@/lib/server/dealApiContext";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes need headroom beyond the default
// 10s for cold-start auth + multi-step Supabase I/O. Preserved from the
// pre-consolidation /policy/mitigants/list route.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Resolve one canonical Clerk + tenant context for every verb.
async function loadAuthContext(
  ctx: { params: Promise<{ dealId: string }> },
): Promise<
  | {
      ok: true;
      sb: SupabaseClient;
      userId: string;
      dealId: string;
      bankId: string;
    }
  | { ok: false; response: NextResponse }
> {
  const { dealId } = await ctx.params;
  if (!dealId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "missing_deal_id" },
        { status: 400 },
      ),
    };
  }

  const access = await resolveDealApiContext(dealId);
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: access.error },
        { status: access.status },
      ),
    };
  }

  return {
    ok: true,
    sb: access.sb,
    userId: access.actorProfileId,
    dealId: access.dealId,
    bankId: access.bankId,
  };
}

// ── GET: list mitigants (was /policy/mitigants/list) ────────────────────

export async function GET(
  _: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const auth = await loadAuthContext(ctx);
  if (!auth.ok) return auth.response;
  const { sb, dealId } = auth;

  const q = await sb
    .from("deal_mitigants")
    .select(
      "id, mitigant_key, mitigant_label, reason_rule_keys, status, satisfied_at, note, created_at, updated_at",
    )
    .eq("deal_id", dealId)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  if (q.error)
    return NextResponse.json(
      { ok: false, error: "list_failed", detail: q.error.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true, items: q.data ?? [] });
}

// ── POST: dispatch to set-status or sync via body.action ────────────────

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const auth = await loadAuthContext(ctx);
  if (!auth.ok) return auth.response;
  const { sb, userId, dealId, bankId } = auth;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const action = String(body?.action || "").trim();

  if (action === "set-status") {
    return handleSetStatus(sb, body, dealId, bankId, userId);
  }
  if (action === "sync") {
    return handleSync(sb, body, dealId, bankId);
  }

  return NextResponse.json(
    { ok: false, error: `unknown action: ${action || "(missing)"}` },
    { status: 400 },
  );
}

// ── set-status branch (was POST /policy/mitigants/set-status) ───────────

async function handleSetStatus(
  sb: SupabaseClient,
  body: any,
  dealId: string,
  bankId: string,
  userId: string,
) {
  const mitigant_key = String(body?.mitigant_key || "").trim();
  const status = String(body?.status || "").trim();
  const note = body?.note ? String(body.note).trim() : null;

  if (!mitigant_key)
    return NextResponse.json(
      { ok: false, error: "missing_mitigant_key" },
      { status: 400 },
    );
  if (!["open", "satisfied", "waived"].includes(status))
    return NextResponse.json(
      { ok: false, error: "invalid_status" },
      { status: 400 },
    );

  const patch: any = { status, note };

  if (status === "satisfied") {
    patch.satisfied_at = new Date().toISOString();
    patch.satisfied_by = userId;
  } else {
    patch.satisfied_at = null;
    patch.satisfied_by = null;
  }

  const up = await sb
    .from("deal_mitigants")
    .update(patch)
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("mitigant_key", mitigant_key);

  if (up.error)
    return NextResponse.json(
      { ok: false, error: "update_failed", detail: up.error.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true });
}

// ── sync branch (was POST /policy/mitigants/sync) ───────────────────────
//
// Sync mitigants into deal_mitigants table.
// Input: { actions: [{key,label,priority,reason_rule_keys}] }
// - Upserts (deal_id, mitigant_key)
// - Never auto-closes; user must mark satisfied/waived.

async function handleSync(
  sb: SupabaseClient,
  body: any,
  dealId: string,
  bankId: string,
) {
  const actions = Array.isArray(body?.actions) ? body.actions : [];
  const rows = actions
    .map((a: any) => ({
      deal_id: dealId,
      bank_id: bankId,
      mitigant_key: String(a?.key || "").trim(),
      mitigant_label: String(a?.label || "").trim(),
      reason_rule_keys: Array.isArray(a?.reason_rule_keys)
        ? a.reason_rule_keys.map((x: any) => String(x))
        : [],
    }))
    .filter((r: any) => r.mitigant_key && r.mitigant_label);

  if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0 });

  // Upsert, but preserve existing status fields by only writing label/reasons on conflict
  const up = await sb.from("deal_mitigants").upsert(
    rows.map((r: any) => ({
      deal_id: r.deal_id,
      bank_id: r.bank_id,
      mitigant_key: r.mitigant_key,
      mitigant_label: r.mitigant_label,
      reason_rule_keys: r.reason_rule_keys,
    })),
    { onConflict: "deal_id,mitigant_key" },
  );

  if (up.error)
    return NextResponse.json(
      { ok: false, error: "sync_failed", detail: up.error.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true, upserted: rows.length });
}
