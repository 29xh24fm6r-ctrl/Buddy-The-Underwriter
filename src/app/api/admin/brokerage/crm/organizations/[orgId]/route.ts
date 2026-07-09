import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/crm/organizations/[orgId] — one organization's detail:
 * its people and its activity timeline (crm_activities where
 * target_organization_id = orgId, or target_person_id for any person
 * belonging to this org), newest first — the Twenty TimelineActivity pattern.
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
  { params }: { params: Promise<{ orgId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { orgId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: org, error: orgErr } = await sb
    .from("crm_organizations")
    .select("*")
    .eq("id", orgId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();

  if (orgErr) {
    return NextResponse.json({ ok: false, error: orgErr.message }, { status: 500 });
  }
  if (!org) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const { data: people, error: peopleErr } = await sb
    .from("crm_people")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .eq("organization_id", orgId)
    .order("last_name", { ascending: true });

  if (peopleErr) {
    return NextResponse.json({ ok: false, error: peopleErr.message }, { status: 500 });
  }

  const personIds = (people ?? []).map((p: any) => p.id);

  const { data: activities, error: actErr } = await sb
    .from("crm_activities")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .or(
      [
        `target_organization_id.eq.${orgId}`,
        personIds.length > 0 ? `target_person_id.in.(${personIds.join(",")})` : null,
      ]
        .filter(Boolean)
        .join(","),
    )
    .order("happens_at", { ascending: false })
    .limit(100);

  if (actErr) {
    return NextResponse.json({ ok: false, error: actErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    organization: org,
    people: people ?? [],
    activities: activities ?? [],
  });
}
