import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { upsertBrokerageLead } from "@/lib/brokerage/leads";
import { listLeadQueue, LEAD_QUEUES, type LeadQueue } from "@/lib/leads/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/brokerage/crm/leads
 *
 * Staff-submitted lead — e.g. a referral partner calls in a borrower who
 * hasn't self-served through the concierge chat yet. This is the manual
 * counterpart to the automatic capture in claimBorrowerSession(); both
 * write through the same upsertBrokerageLead() so a person only ever
 * gets one lead row regardless of how they entered.
 */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}) as any);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!email && !phone) {
    return NextResponse.json(
      { ok: false, error: "email or phone is required" },
      { status: 400 },
    );
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  let organizationId: string | null = null;
  if (typeof body?.organizationId === "string" && body.organizationId) {
    const { data: org } = await sb
      .from("crm_organizations")
      .select("id, name")
      .eq("id", body.organizationId)
      .eq("bank_id", brokerageBankId)
      .maybeSingle();
    if (!org) {
      return NextResponse.json({ ok: false, error: "organization not found" }, { status: 404 });
    }
    organizationId = org.id;
  }

  let result;
  try {
    result = await upsertBrokerageLead({
      bankId: brokerageBankId,
      source: "referral_partner",
      email: email || null,
      phone: phone || null,
      firstName: typeof body?.firstName === "string" ? body.firstName : null,
      lastName: typeof body?.lastName === "string" ? body.lastName : null,
      businessName: typeof body?.businessName === "string" ? body.businessName : null,
      loanAmountRequested:
        typeof body?.loanAmountRequested === "number" ? body.loanAmountRequested : null,
      loanPurpose: typeof body?.loanPurpose === "string" ? body.loanPurpose : null,
      referralSourceOrgId: organizationId,
      metadata: body?.notes ? { notes: body.notes } : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  if (!result) {
    return NextResponse.json(
      { ok: false, error: "email or phone is required" },
      { status: 400 },
    );
  }

  if (organizationId) {
    const label = [body?.firstName, body?.lastName].filter(Boolean).join(" ") || email || phone;
    await sb.from("crm_activities").insert({
      bank_id: brokerageBankId,
      kind: "system",
      title: `Lead submitted: ${label}`,
      properties: { leadId: result.id },
      actor_clerk_user_id: userId,
      target_organization_id: organizationId,
    });
  }

  return NextResponse.json({ ok: true, leadId: result.id, isNew: result.isNew });
}

/**
 * GET /api/admin/brokerage/crm/leads?status=new
 * GET /api/admin/brokerage/crm/leads?queue=overdue_follow_up
 *
 * Plain status-filtered listing (back-compat) or one of the pipeline
 * queues from §4.4 (my leads, unassigned, overdue follow-up, stale, ...).
 */
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const status = req.nextUrl.searchParams.get("status");
  const queue = req.nextUrl.searchParams.get("queue");

  if (queue) {
    if (!(LEAD_QUEUES as readonly string[]).includes(queue)) {
      return NextResponse.json({ ok: false, error: `Unknown queue. Must be one of: ${LEAD_QUEUES.join(", ")}` }, { status: 400 });
    }
    try {
      const leads = await listLeadQueue({ bankId: brokerageBankId, queue: queue as LeadQueue, actorClerkUserId: userId });
      return NextResponse.json({ ok: true, queue, leads });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  const sb = supabaseAdmin();
  let query = sb
    .from("brokerage_leads")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, leads: data ?? [] });
}
