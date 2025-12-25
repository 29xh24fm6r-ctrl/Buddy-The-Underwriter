// src/app/api/admin/reminders/stats/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reminder system health stats
 *
 * Returns:
 * - Active subscriptions
 * - Due now / next 24h
 * - Runs in last 24h (sent/skipped/error)
 * - Error rate
 */

type StatsResponse = {
  ok: boolean;
  timestamp: string;
  subscriptions: {
    total_active: number;
    due_now: number;
    due_next_24h: number;
  };
  runs_last_24h: {
    total: number;
    sent: number;
    skipped: number;
    error: number;
    error_rate_pct: number;
  };
  runs_last_7d: {
    total: number;
    error: number;
    error_rate_pct: number;
  };
  health: "healthy" | "degraded" | "critical";
};

export async function GET() {
  const sb = supabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // 1) Active subscriptions
    const { count: totalActive } = await sb
      .from("deal_reminder_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("active", true);

    // 2) Due now
    const { count: dueNow } = await sb
      .from("deal_reminder_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .lte("next_run_at", nowIso);

    // 3) Due in next 24h
    const { count: dueNext24h } = await sb
      .from("deal_reminder_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .lte("next_run_at", in24h);

    // 4) Runs last 24h by status
    const { data: runs24h } = await sb
      .from("deal_reminder_runs")
      .select("status")
      .gte("ran_at", ago24h);

    const runs24hByStatus = (runs24h || []).reduce(
      (acc, r) => {
        acc[r.status as "sent" | "skipped" | "error"] =
          (acc[r.status as "sent" | "skipped" | "error"] || 0) + 1;
        return acc;
      },
      { sent: 0, skipped: 0, error: 0 } as Record<
        "sent" | "skipped" | "error",
        number
      >,
    );

    const total24h = runs24h?.length || 0;
    const error24h = runs24hByStatus.error || 0;
    const errorRate24h = total24h > 0 ? (error24h / total24h) * 100 : 0;

    // 5) Runs last 7d (error count)
    const { data: runs7d } = await sb
      .from("deal_reminder_runs")
      .select("status")
      .gte("ran_at", ago7d);

    const total7d = runs7d?.length || 0;
    const error7d = runs7d?.filter((r) => r.status === "error").length || 0;
    const errorRate7d = total7d > 0 ? (error7d / total7d) * 100 : 0;

    // 6) Health classification
    let health: "healthy" | "degraded" | "critical" = "healthy";
    if (errorRate24h > 50) {
      health = "critical";
    } else if (errorRate24h > 10) {
      health = "degraded";
    }

    const stats: StatsResponse = {
      ok: true,
      timestamp: nowIso,
      subscriptions: {
        total_active: totalActive ?? 0,
        due_now: dueNow ?? 0,
        due_next_24h: dueNext24h ?? 0,
      },
      runs_last_24h: {
        total: total24h,
        sent: runs24hByStatus.sent,
        skipped: runs24hByStatus.skipped,
        error: error24h,
        error_rate_pct: Math.round(errorRate24h * 100) / 100,
      },
      runs_last_7d: {
        total: total7d,
        error: error7d,
        error_rate_pct: Math.round(errorRate7d * 100) / 100,
      },
      health,
    };

    return NextResponse.json(stats);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "stats_failed",
        detail: error?.message || "Unknown error",
      },
      { status: 500 },
    );
  }
}
