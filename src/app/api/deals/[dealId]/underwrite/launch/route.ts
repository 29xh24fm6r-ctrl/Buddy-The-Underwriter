import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    // Idempotent — return existing workspace if already initialized
    const { data: existing } = await sb
      .from("underwriting_workspaces")
      .select("id, active_snapshot_id")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, workspaceId: existing.id, status: "already_initialized" });
    }

    // Gather minimal snapshot data
    const { data: deal } = await sb
      .from("deals")
      .select("id, name, stage, bank_id, borrower_id")
      .eq("id", dealId)
      .single();

    if (!deal) return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });

    const [borrowerRes, loanReqRes, checklistRes, docRes] = await Promise.all([
      sb.from("borrowers").select("id, legal_name, entity_type").eq("id", deal.borrower_id ?? "").maybeSingle(),
      sb.from("deal_loan_requests").select("*").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("deal_checklist_items").select("checklist_key, required, received_at, status").eq("deal_id", dealId),
      sb.from("deal_documents").select("id, canonical_type, doc_year").eq("deal_id", dealId),
    ]);

    // Create snapshot
    const { data: snapshot, error: snapErr } = await sb
      .from("underwriting_launch_snapshots")
      .insert({
        deal_id: dealId,
        launch_sequence: 1,
        launched_by: userId,
        launched_at: new Date().toISOString(),
        lifecycle_stage_at_launch: deal.stage ?? "collecting",
        borrower_snapshot_json: borrowerRes.data ?? {},
        deal_snapshot_json: { id: deal.id, name: deal.name, stage: deal.stage },
        loan_request_snapshot_json: loanReqRes.data ?? {},
        requirement_snapshot_json: checklistRes.data ?? [],
        document_snapshot_json: docRes.data ?? [],
        readiness_snapshot_json: {},
        blocker_snapshot_json: [],
        certification_json: { certifiedAt: new Date().toISOString(), certifiedBy: userId },
        canonical_loan_request_id: loanReqRes.data?.id ?? null,
        financial_snapshot_id: null,
      })
      .select("id")
      .single();

    if (snapErr) return NextResponse.json({ ok: false, error: snapErr.message }, { status: 500 });

    // Create workspace
    const { data: workspace, error: wsErr } = await sb
      .from("underwriting_workspaces")
      .insert({
        deal_id: dealId,
        active_snapshot_id: snapshot.id,
        status: "active",
        launched_at: new Date().toISOString(),
        launched_by: userId,
        spread_status: "not_started",
        memo_status: "not_started",
        risk_status: "not_started",
        refresh_required: false,
      })
      .select("id")
      .single();

    if (wsErr) return NextResponse.json({ ok: false, error: wsErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, workspaceId: workspace.id, snapshotId: snapshot.id, status: "initialized" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected" }, { status: 500 });
  }
}
