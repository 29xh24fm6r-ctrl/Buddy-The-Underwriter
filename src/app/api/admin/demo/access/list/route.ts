import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function enforceSuperAdmin() {
  try {
    await requireSuperAdmin();
    return null;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "unauthorized")
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    if (msg === "forbidden")
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

export async function GET() {
  const auth = await enforceSuperAdmin();
  if (auth) return auth;

  const sb = supabaseAdmin();
  const now = new Date();
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: allowlist, error: allowErr } = await sb
      .from("sandbox_access_allowlist")
      .select("email, role, created_at, enabled")
      .eq("enabled", true)
      .not("email", "is", null)
      .order("created_at", { ascending: false });

    if (allowErr) {
      return NextResponse.json(
        { ok: false, error: allowErr.message },
        { status: 500 },
      );
    }

    const emails = (allowlist ?? [])
      .map((row: any) => normalizeEmail(row?.email))
      .filter(Boolean);

    const activityByEmail = new Map<string, any>();
    if (emails.length > 0) {
      const { data: activity } = await sb
        .from("demo_user_activity")
        .select("email, role, last_seen_at, last_path")
        .in("email", emails);

      for (const row of activity ?? []) {
        activityByEmail.set(normalizeEmail(row.email), row);
      }
    }

    const { data: events24h } = await sb
      .from("demo_usage_events")
      .select("email, event_type, created_at")
      .gte("created_at", ago24h);

    const { data: events7d } = await sb
      .from("demo_usage_events")
      .select("email, event_type, route, label, created_at")
      .gte("created_at", ago7d);

    const counts24h = new Map<string, { pageviews: number; clicks: number }>();
    for (const ev of events24h ?? []) {
      const email = normalizeEmail(ev?.email);
      if (!email) continue;
      const entry = counts24h.get(email) ?? { pageviews: 0, clicks: 0 };
      if (ev?.event_type === "pageview") entry.pageviews += 1;
      if (ev?.event_type === "click") entry.clicks += 1;
      counts24h.set(email, entry);
    }

    const counts7dActions = new Map<string, number>();
    const routeCounts = new Map<string, number>();
    const ctaCounts = new Map<string, number>();
    const actionCounts = new Map<string, number>();
    const lastEventByEmail = new Map<string, { route: string | null; createdAt: string | null }>();

    for (const ev of events7d ?? []) {
      const email = normalizeEmail(ev?.email);
      if (ev?.event_type === "action" && email) {
        counts7dActions.set(email, (counts7dActions.get(email) ?? 0) + 1);
        if (ev?.label) {
          const label = String(ev.label);
          actionCounts.set(label, (actionCounts.get(label) ?? 0) + 1);
        }
      }
      if (ev?.event_type === "pageview" && ev?.route) {
        const route = String(ev.route);
        routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
      }
      if (ev?.event_type === "click" && ev?.label) {
        const label = String(ev.label);
        ctaCounts.set(label, (ctaCounts.get(label) ?? 0) + 1);
      }

      if (email) {
        const existing = lastEventByEmail.get(email);
        const createdAt = ev?.created_at ? String(ev.created_at) : null;
        if (!existing || (createdAt && createdAt > String(existing.createdAt))) {
          lastEventByEmail.set(email, {
            route: ev?.route ? String(ev.route) : null,
            createdAt,
          });
        }
      }
    }

    const items = (allowlist ?? []).map((row: any) => {
      const email = normalizeEmail(row?.email);
      const activity = activityByEmail.get(email);
      const c24 = counts24h.get(email) ?? { pageviews: 0, clicks: 0 };
      const actions7d = counts7dActions.get(email) ?? 0;
      return {
        email,
        role: row?.role ?? activity?.role ?? "banker",
        created_at: row?.created_at ?? null,
        last_seen_at: activity?.last_seen_at ?? null,
        last_path: activity?.last_path ?? null,
        counts: {
          pageviews_24h: c24.pageviews,
          clicks_24h: c24.clicks,
          actions_7d: actions7d,
        },
      };
    });

    const top_routes_7d = Array.from(routeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([route, count]) => ({ route, count }));

    const top_ctas_7d = Array.from(ctaCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count }));

    const top_actions_7d = Array.from(actionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count }));

    const dropoffCounts = new Map<string, number>();
    const now = Date.now();
    for (const entry of lastEventByEmail.values()) {
      if (!entry.createdAt || !entry.route) continue;
      const lastTs = new Date(entry.createdAt).getTime();
      if (!Number.isFinite(lastTs)) continue;
      if (now - lastTs > 30 * 60 * 1000) {
        dropoffCounts.set(entry.route, (dropoffCounts.get(entry.route) ?? 0) + 1);
      }
    }

    const top_dropoffs_30m = Array.from(dropoffCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([route, count]) => ({ route, count }));

    return NextResponse.json({
      ok: true,
      items,
      top_routes_7d,
      top_ctas_7d,
      top_actions_7d,
      top_dropoffs_30m,
    });
  } catch (err: any) {
    console.error("/api/admin/demo/access/list", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "list_failed" },
      { status: 500 },
    );
  }
}
