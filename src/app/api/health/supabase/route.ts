import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function tableExists(supabase: any, table: string) {
  // Uses PostgREST metadata behavior: selecting from missing table returns error.
  const { error } = await supabase.from(table).select("id", { head: true, count: "exact" }).limit(1);
  if (!error) return { table, ok: true as const };
  const msg = String(error.message || "");
  const missing = msg.includes("42P01") || msg.toLowerCase().includes("does not exist");
  return { table, ok: false as const, missing, error: msg };
}

export async function GET() {
  try {
    const env = getEnv();
    const supabase = getSupabaseServerClient();

    // "Reachability" probe: a lightweight query against a known table in your app.
    // If deals table doesn't exist yet, we still return structured results.
    const checks = await Promise.all([
      tableExists(supabase, "deals"),
      tableExists(supabase, "banks"),
      tableExists(supabase, "deal_assignees"),
    ]);

    const ok = checks.some((c) => c.table === "deals" && c.ok);

    return NextResponse.json(
      {
        ok,
        env: {
          hasServiceRole: env.hasServiceRole,
          supabaseUrlHost: new URL(env.supabaseUrl).host,
        },
        checks,
        hint: ok
          ? "✅ Supabase reachable + deals table exists."
          : "❌ Supabase reachable check failed or deals table missing. Fix env OR run migrations.",
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "healthcheck_failed" },
      { status: 500 }
    );
  }
}
