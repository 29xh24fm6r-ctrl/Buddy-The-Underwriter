import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authzError(err: any) {
  const msg = String(err?.message ?? err);
  if (msg === "unauthorized")
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (msg === "forbidden")
    return { status: 403, body: { ok: false, error: "forbidden" } };
  return null;
}

function parseBool(v: string | null): boolean | null {
  if (v == null) return null;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

/**
 * GET /api/admin/audit/list
 * 
 * Super-admin audit/compliance ledger.
 * Source: public.audit_ledger (canonical read interface)
 * 
 * Query params:
 * - limit: number (default 50, max 200)
 * - cursor: ISO created_at (fetch older rows)
 * - dealId
 * - actorUserId
 * - scope
 * - action
 * - kind
 * - requiresHumanReview (true/false)
 * - q (substring match across deal_id/actor_user_id/scope/action/kind)
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin();

    const url = new URL(req.url);
    const limitRaw = parseInt(url.searchParams.get("limit") || "50", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    const cursor = url.searchParams.get("cursor");
    const dealId = url.searchParams.get("dealId");
    const actorUserId = url.searchParams.get("actorUserId");
    const scope = url.searchParams.get("scope");
    const action = url.searchParams.get("action");
    const kind = url.searchParams.get("kind");
    const requiresHumanReview = parseBool(url.searchParams.get("requiresHumanReview"));
    const q = (url.searchParams.get("q") ?? "").trim();

    const sb = supabaseAdmin();

    let query = sb
      .from("audit_ledger")
      .select(
        "id, deal_id, actor_user_id, scope, action, kind, input_json, output_json, confidence, evidence_json, requires_human_review, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    if (dealId) query = query.eq("deal_id", dealId);
    if (actorUserId) query = query.eq("actor_user_id", actorUserId);
    if (scope) query = query.eq("scope", scope);
    if (action) query = query.eq("action", action);
    if (kind) query = query.eq("kind", kind);
    if (requiresHumanReview !== null) {
      query = query.eq("requires_human_review", requiresHumanReview);
    }

    if (q) {
      const escaped = q.replaceAll("%", "\\%").replaceAll("_", "\\_");
      query = query.or(
        [
          `deal_id.ilike.%${escaped}%`,
          `actor_user_id.ilike.%${escaped}%`,
          `scope.ilike.%${escaped}%`,
          `action.ilike.%${escaped}%`,
          `kind.ilike.%${escaped}%`,
        ].join(","),
      );
    }

    const { data: events, error } = (await query) as any;

    if (error) {
      console.error("[/api/admin/audit/list]", error.message, {
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json(
        { ok: false, error: "Failed to load audit ledger" },
        { status: 500 },
      );
    }

    const nextCursor =
      events && events.length > 0 ? (events[events.length - 1]?.created_at ?? null) : null;

    return NextResponse.json({ ok: true, events: events ?? [], nextCursor });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("[/api/admin/audit/list]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
