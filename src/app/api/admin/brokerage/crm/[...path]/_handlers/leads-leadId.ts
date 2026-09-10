import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { canDeleteBrokerageCrmRecords, requireBrokerageAdmin, requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { getQualification } from "@/lib/leads/qualification";
import { updateLeadFields } from "@/lib/leads/pipeline";
import { beginCrmDeletion, confirmationMatches, finishCrmDeletion } from "@/lib/crm/adminDeletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/crm/leads/[leadId] — one lead's detail: the record
 * itself, its qualification (if started), and its crm_activities timeline
 * (contact attempts + stage changes).
 *
 * PATCH only edits plain fields (owner, priority, next action, ...) —
 * stage transitions and conversion are audited commands that live under
 * ./actions, not a generic field patch.
 */

async function gate(): Promise<{ userId: string } | NextResponse> {
  try {
    return await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { leadId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: lead, error } = await sb
    .from("brokerage_leads")
    .select("*")
    .eq("id", leadId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!lead) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const qualification = await getQualification(brokerageBankId, leadId, sb);

  const { data: activities } = await sb
    .from("crm_activities")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .eq("target_lead_id", leadId)
    .order("happens_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ ok: true, lead, qualification, activities: activities ?? [], permissions: { canDelete: await canDeleteBrokerageCrmRecords() } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  let actorUserId: string;
  try {
    ({ userId: actorUserId } = await requireBrokerageAdmin());
  } catch {
    return NextResponse.json({ ok: false, error: "admin_required" }, { status: 403 });
  }
  const { leadId } = await params;
  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const { data: lead, error: leadError } = await sb
    .from("brokerage_leads").select("*").eq("id", leadId).eq("bank_id", bankId).maybeSingle();
  if (leadError) return NextResponse.json({ ok: false, error: leadError.message }, { status: 500 });
  if (!lead) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const label = lead.business_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || "Unnamed lead";
  const body = await req.json().catch(() => ({})) as { confirmation?: unknown };
  if (!confirmationMatches(body?.confirmation, label)) {
    return NextResponse.json({ ok: false, error: "confirmation_mismatch" }, { status: 400 });
  }
  if (lead.converted_deal_id) {
    return NextResponse.json({ ok: false, error: "record_in_use", blockers: ["a converted deal"] }, { status: 409 });
  }
  let auditId: string;
  try {
    auditId = await beginCrmDeletion({ sb, bankId, actorUserId, entityType: "lead", entityId: leadId, entityLabel: label, snapshot: lead });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "deletion_audit_failed" }, { status: 500 });
  }
  const { data: deleted, error: deleteError } = await sb.from("brokerage_leads").delete().eq("id", leadId).eq("bank_id", bankId).select("id").maybeSingle();
  const finalDeleteError = deleteError ?? (!deleted ? new Error("delete_not_confirmed") : null);
  await finishCrmDeletion(sb, auditId, finalDeleteError ? { ok: false, reason: finalDeleteError.message } : { ok: true });
  if (finalDeleteError) return NextResponse.json({ ok: false, error: finalDeleteError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { leadId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  try {
    const lead = await updateLeadFields({
      bankId: brokerageBankId,
      leadId,
      ownerClerkUserId: body?.ownerClerkUserId,
      priority: body?.priority,
      loanProgram: body?.loanProgram,
      nextAction: body?.nextAction,
      nextActionDueAt: body?.nextActionDueAt,
      expectedConversionDate: body?.expectedConversionDate,
      competitorOrAlternateFinancing: body?.competitorOrAlternateFinancing,
    });
    return NextResponse.json({ ok: true, lead });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
