import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = supabaseAdmin();

  const run = await sb
    .from("storage_scan_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (run.error)
    return NextResponse.json(
      { ok: false, error: run.error.message },
      { status: 500 },
    );
  if (!run.data)
    return NextResponse.json({ ok: true, run: null, findings: [] });

  const findings = await sb
    .from("orphan_findings")
    .select("*")
    .eq("scan_run_id", run.data.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (findings.error)
    return NextResponse.json(
      { ok: false, error: findings.error.message },
      { status: 500 },
    );

  return NextResponse.json({
    ok: true,
    run: run.data,
    findings: findings.data || [],
  });
}
