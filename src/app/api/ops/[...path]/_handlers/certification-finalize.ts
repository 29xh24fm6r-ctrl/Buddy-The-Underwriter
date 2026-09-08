import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { verifyBrokerageCertificationOidc } from "@/lib/auth/githubActionsOidc";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CertificationReport = {
  ran_at?: unknown;
  baseline_commit?: unknown;
  pass_count?: unknown;
  total?: unknown;
  pass_rate?: unknown;
  threshold?: unknown;
  repeat_ask_violation_count?: unknown;
};

export async function POST(req: NextRequest) {
  const claims = await verifyBrokerageCertificationOidc(req);
  if (!claims) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { dealIds?: unknown; report?: CertificationReport; passedGate?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const dealIds = Array.isArray(body.dealIds)
    ? [...new Set(body.dealIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))]
    : [];
  if (dealIds.length === 0 || dealIds.length > 25 || body.passedGate !== true && body.passedGate !== false) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const report = body.report ?? {};
  if (
    typeof report.ran_at !== "string" ||
    typeof report.baseline_commit !== "string" ||
    typeof report.pass_count !== "number" ||
    typeof report.total !== "number" ||
    typeof report.pass_rate !== "number"
  ) {
    return NextResponse.json({ ok: false, error: "invalid_report" }, { status: 400 });
  }
  if (report.baseline_commit !== claims.sha) {
    return NextResponse.json({ ok: false, error: "release_identity_mismatch" }, { status: 409 });
  }

  const sb = supabaseAdmin();
  const runId = `brokerage-certification:${report.baseline_commit}:${report.ran_at}`;
  const { data: updated, error: updateError } = await sb
    .from("deals")
    .update({
      is_test: true,
      test_suite: "borrower_e2e",
      test_identity: "borrower_qa",
      test_run_id: runId,
      test_created_at: report.ran_at,
    })
    .in("id", dealIds)
    .select("id,is_test");

  if (updateError || updated?.length !== dealIds.length || updated.some((row) => row.is_test !== true)) {
    return NextResponse.json(
      { ok: false, error: "synthetic_deal_classification_failed" },
      { status: 500 },
    );
  }

  const { error: evidenceError } = await sb.from("ai_events").insert({
    deal_id: null,
    scope: "synth_borrower_e2e",
    action: body.passedGate ? "passed" : "failed",
    output_json: {
      ran_at: report.ran_at,
      baseline_commit: report.baseline_commit,
      pass_count: report.pass_count,
      total: report.total,
      pass_rate: report.pass_rate,
      threshold: report.threshold,
      repeat_ask_violation_count: report.repeat_ask_violation_count,
      classified_deal_count: dealIds.length,
    },
    confidence: 1,
    requires_human_review: !body.passedGate,
  });

  if (evidenceError) {
    return NextResponse.json(
      { ok: false, error: "durable_evidence_persistence_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, classifiedDealCount: dealIds.length });
}
