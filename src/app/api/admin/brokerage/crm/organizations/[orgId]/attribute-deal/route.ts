import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/brokerage/crm/organizations/[orgId]/attribute-deal
 *
 * Sets deals.referral_source_org_id — the link that ties a CRM
 * relationship to actual revenue. Also drops a system activity on the
 * org's timeline so "we attributed deal X to this org" shows up in the
 * same feed as notes/calls, not as a silent database write.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { orgId } = await params;
  const body = await req.json().catch(() => ({}) as any);
  const dealId = typeof body?.dealId === "string" ? body.dealId : "";
  if (!dealId) {
    return NextResponse.json({ ok: false, error: "dealId is required" }, { status: 400 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: org, error: orgErr } = await sb
    .from("crm_organizations")
    .select("id, name")
    .eq("id", orgId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();
  if (orgErr) return NextResponse.json({ ok: false, error: orgErr.message }, { status: 500 });
  if (!org) return NextResponse.json({ ok: false, error: "organization not found" }, { status: 404 });

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .update({ referral_source_org_id: orgId })
    .eq("id", dealId)
    .eq("bank_id", brokerageBankId)
    .select("id, display_name, borrower_name, name")
    .maybeSingle();
  if (dealErr) return NextResponse.json({ ok: false, error: dealErr.message }, { status: 500 });
  if (!deal) return NextResponse.json({ ok: false, error: "deal not found" }, { status: 404 });

  const dealLabel = deal.display_name || deal.borrower_name || deal.name || dealId.slice(0, 8);

  await sb.from("crm_activities").insert({
    bank_id: brokerageBankId,
    kind: "system",
    title: `Deal attributed: ${dealLabel}`,
    properties: { dealId },
    actor_clerk_user_id: userId,
    target_organization_id: orgId,
  });

  return NextResponse.json({ ok: true, deal });
}
