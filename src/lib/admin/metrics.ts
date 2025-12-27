import { supabaseAdmin } from "@/lib/supabase/admin";

type Bucket = { ts: string; count: number };

function bucketByHour(rows: { created_at: string }[]): Bucket[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const d = new Date(r.created_at);
    d.setMinutes(0, 0, 0);
    const key = d.toISOString();
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, count]) => ({ ts, count }));
}

export async function getMetrics(range: "24h" | "7d" = "24h") {
  const hours = range === "24h" ? 24 : 24 * 7;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data } = await supabaseAdmin()
    .from("audit_compliance_ledger")
    .select("action, created_at, scope")
    .gte("created_at", since);

  const rows = data ?? [];
  const ai = rows.filter(r => r.scope === "ai");
  const errors = rows.filter(r => r.action?.includes("error"));
  const rateLimits = rows.filter(r => r.action === "rate_limited");

  const byAction = (rows: typeof data) =>
    (rows ?? []).reduce<Record<string, number>>((acc, r) => {
      acc[r.action ?? "unknown"] = (acc[r.action ?? "unknown"] ?? 0) + 1;
      return acc;
    }, {});

  return {
    totals: {
      ai: ai.length,
      errors: errors.length,
      rateLimits: rateLimits.length,
    },
    timeseries: {
      ai: bucketByHour(ai),
      errors: bucketByHour(errors),
      rateLimits: bucketByHour(rateLimits),
    },
    breakdowns: {
      aiByAction: byAction(ai),
      errorByAction: byAction(errors),
    },
  };
}
