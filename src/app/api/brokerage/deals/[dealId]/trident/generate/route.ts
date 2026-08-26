import "server-only";

/**
 * POST /api/brokerage/deals/[dealId]/trident/generate
 *
 * Manual trigger for bundle generation. Admin-only for v1 (brokerage tenant
 * member). Not exposed to borrowers directly — borrowers download via the
 * separate `/trident/download/[kind]` route which is gated by the
 * session-cookie-owns-this-deal check.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startTridentGeneration } from "@/lib/brokerage/trident/startTridentGeneration";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { getTridentReadiness } from "@/lib/brokerage/trident/tridentReadiness";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  try {
    await requireBrokerageStaff();
  } catch (error) {
    const message = error instanceof Error ? error.message : "forbidden";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "unauthorized" ? 401 : 403 },
    );
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();
  if (!deal) {
    return NextResponse.json({ ok: false, error: "deal_not_found_for_brokerage" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    mode?: "preview" | "final";
  };
  const mode = body.mode ?? "preview";

  if (mode === "final") {
    const readiness = await getTridentReadiness({ sb, dealId, bankId: brokerageBankId });
    if (!readiness.ok) {
      return NextResponse.json(
        { ok: false, error: "trident_not_ready", reasons: readiness.reasons, evidence: readiness.evidence },
        { status: 409 },
      );
    }
  }

  const started = await startTridentGeneration({ dealId, mode });
  if (!started.ok) {
    return NextResponse.json(
      { ok: false, bundleId: started.bundleId, error: started.error },
      { status: 500 },
    );
  }
  return NextResponse.json(
    started.alreadyRunning
      ? { ok: true, accepted: true, bundleId: started.bundleId, alreadyRunning: true }
      : { ok: true, accepted: true, bundleId: started.bundleId, runId: started.runId },
    { status: 202 },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  try {
    await requireBrokerageStaff();
  } catch (error) {
    const message = error instanceof Error ? error.message : "forbidden";
    return NextResponse.json({ ok: false, error: message }, { status: message === "unauthorized" ? 401 : 403 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const requestedBundleId = _req.nextUrl.searchParams.get("bundleId")?.trim() || null;
  if (
    requestedBundleId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedBundleId)
  ) {
    return NextResponse.json({ ok: false, error: "invalid_bundle_id" }, { status: 400 });
  }

  const bundleQuery = sb
    .from("buddy_trident_bundles")
    .select("id,status,current_stage,workflow_run_id,generation_error,stage_error_json,generation_started_at,generation_completed_at,last_heartbeat_at,release_gate_json,business_plan_pdf_path,projections_pdf_path,projections_xlsx_path,feasibility_pdf_path")
    .eq("deal_id", dealId)
    .eq("bank_id", brokerageBankId)
    .eq("mode", "final");

  const { data: bundle, error } = requestedBundleId
    ? await bundleQuery.eq("id", requestedBundleId).maybeSingle()
    : await bundleQuery
        .order("generation_started_at", { ascending: false, nullsFirst: false })
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (requestedBundleId && !bundle) {
    return NextResponse.json({ ok: false, error: "bundle_not_found" }, { status: 404 });
  }
  const { data: stages, error: stagesError } = bundle?.id
    ? await sb.from("buddy_trident_bundle_stages")
        .select("stage,status,attempt_count,output_json,error_json,started_at,completed_at,updated_at")
        .eq("bundle_id", bundle.id).order("started_at", { ascending: true })
    : { data: [], error: null };
  if (stagesError) return NextResponse.json({ ok: false, error: stagesError.message }, { status: 500 });
  return NextResponse.json({ ok: true, bundle, stages: stages ?? [] });
}
