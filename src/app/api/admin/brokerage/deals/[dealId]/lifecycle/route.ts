import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageAdmin } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDealLabel } from "@/lib/deals/dealLabel";
import { beginCrmDeletion, confirmationMatches, finishCrmDeletion } from "@/lib/crm/adminDeletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "unauthorized";
  return NextResponse.json({ ok: false, error: message }, { status: message === "forbidden" ? 403 : 401 });
}

async function scopedDeal(dealId: string, bankId: string) {
  return supabaseAdmin()
    .from("deals")
    .select("id, bank_id, display_name, nickname, borrower_name, name, loan_amount, brokerage_stage, archived_at, created_at")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  try { await requireBrokerageAdmin(); } catch (error) { return authFailure(error); }
  const { dealId } = await params;
  const bankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}));
  if (body.action !== "archive" && body.action !== "restore") {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }

  const existing = await scopedDeal(dealId, bankId);
  if (existing.error) return NextResponse.json({ ok: false, error: existing.error.message }, { status: 500 });
  if (!existing.data) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const archivedAt = body.action === "archive" ? new Date().toISOString() : null;
  const { data, error } = await supabaseAdmin()
    .from("deals")
    .update({ archived_at: archivedAt })
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .select("id, archived_at")
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, archivedAt: data.archived_at });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  let actor;
  try { actor = await requireBrokerageAdmin(); } catch (error) { return authFailure(error); }
  const { dealId } = await params;
  const bankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}));
  const existing = await scopedDeal(dealId, bankId);
  if (existing.error) return NextResponse.json({ ok: false, error: existing.error.message }, { status: 500 });
  if (!existing.data) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const label = resolveDealLabel(existing.data).label;
  if (!confirmationMatches(body.confirmation, label)) {
    return NextResponse.json({ ok: false, error: "confirmation_mismatch" }, { status: 400 });
  }
  if (!existing.data.archived_at) {
    return NextResponse.json({ ok: false, error: "archive_required" }, { status: 409 });
  }

  let auditId: string;
  try {
    auditId = await beginCrmDeletion({
      sb: supabaseAdmin(), bankId, actorUserId: actor.userId, entityType: "deal",
      entityId: dealId, entityLabel: label, snapshot: existing.data,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "delete_preflight_failed" }, { status: 503 });
  }

  const { data, error } = await supabaseAdmin()
    .from("deals")
    .delete()
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    const reason = error?.message ?? "record_not_deleted";
    await finishCrmDeletion(supabaseAdmin(), auditId, { ok: false, reason });
    if (error?.code === "23503") {
      return NextResponse.json({ ok: false, error: "record_in_use", blockers: ["protected underwriting, document, compliance, or payment records"] }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: reason }, { status: 500 });
  }
  await finishCrmDeletion(supabaseAdmin(), auditId, { ok: true });
  return NextResponse.json({ ok: true });
}
