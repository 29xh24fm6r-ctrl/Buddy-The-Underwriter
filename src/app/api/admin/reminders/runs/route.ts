// src/app/api/admin/reminders/runs/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reminders/runs
 * Query params:
 * - limit (default 50, max 200)
 * - status=sent|skipped|error
 * - subscription_id=uuid
 * - since=ISO (optional, filter ran_at >= since)
 * - before=cursor (optional) format: "<ran_at_iso>|<id>"
 *
 * Returns:
 * { ok, runs, nextCursor }
 *
 * Table schema (confirmed):
 * id uuid
 * subscription_id uuid
 * due_at timestamptz null
 * ran_at timestamptz not null
 * status text not null
 * error text null
 * meta jsonb not null
 */

type RunRow = {
  id: string;
  subscription_id: string;
  due_at: string | null;
  ran_at: string;
  status: "sent" | "skipped" | "error";
  error: string | null;
  meta: any;
};

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseBeforeCursor(
  before: string | null,
): { ran_at: string; id: string } | null {
  if (!before) return null;
  const [ran_at, id] = before.split("|");
  if (!ran_at || !id) return null;
  return { ran_at, id };
}

export async function GET(req: Request) {
  const sb = supabaseAdmin();
  const url = new URL(req.url);

  const limit = clampInt(Number(url.searchParams.get("limit") || 50), 1, 200);
  const status = url.searchParams.get("status");
  const subscriptionId = url.searchParams.get("subscription_id");
  const since = url.searchParams.get("since");
  const before = parseBeforeCursor(url.searchParams.get("before"));

  let q = sb
    .from("deal_reminder_runs")
    .select("id,subscription_id,due_at,ran_at,status,error,meta")
    .order("ran_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (status && ["sent", "skipped", "error"].includes(status)) {
    q = q.eq("status", status);
  }
  if (subscriptionId) {
    q = q.eq("subscription_id", subscriptionId);
  }
  if (since) {
    q = q.gte("ran_at", since);
  }

  // Pagination cursor:
  // (ran_at < cursor.ran_at) OR (ran_at = cursor.ran_at AND id < cursor.id)
  if (before) {
    q = q.or(
      `ran_at.lt.${before.ran_at},and(ran_at.eq.${before.ran_at},id.lt.${before.id})`,
    );
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json(
      { ok: false, error: "runs_fetch_failed", detail: error.message },
      { status: 500 },
    );
  }

  const runs = (data ?? []) as RunRow[];
  const last = runs[runs.length - 1] || null;
  const nextCursor = last ? `${last.ran_at}|${last.id}` : null;

  return NextResponse.json({ ok: true, runs, nextCursor });
}
