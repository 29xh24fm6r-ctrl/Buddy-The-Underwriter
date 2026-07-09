import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/crm/organizations — brokerage CRM organizations.
 *
 * Twenty-inspired data model (crm_organizations / crm_people / crm_activities),
 * clean-room implementation scoped to the Buddy Brokerage tenant. See
 * migration crm_core_organizations_people_activities for the schema notes.
 *
 * GET  -> list organizations with people counts
 * POST -> create an organization
 */

async function gate(): Promise<{ userId: string } | NextResponse> {
  try {
    return await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
}

export async function GET() {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const [{ data: orgs, error: orgErr }, { data: people, error: peopleErr }] =
    await Promise.all([
      sb
        .from("crm_organizations")
        .select("*")
        .eq("bank_id", brokerageBankId)
        .order("name", { ascending: true }),
      sb
        .from("crm_people")
        .select("id, organization_id")
        .eq("bank_id", brokerageBankId),
    ]);

  if (orgErr || peopleErr) {
    return NextResponse.json(
      { ok: false, error: orgErr?.message ?? peopleErr?.message },
      { status: 500 },
    );
  }

  const peopleCountByOrg = new Map<string, number>();
  for (const p of people ?? []) {
    if (!p.organization_id) continue;
    peopleCountByOrg.set(
      p.organization_id,
      (peopleCountByOrg.get(p.organization_id) ?? 0) + 1,
    );
  }

  const result = (orgs ?? []).map((o: any) => ({
    ...o,
    peopleCount: peopleCountByOrg.get(o.id) ?? 0,
  }));

  return NextResponse.json({ ok: true, organizations: result });
}

export async function POST(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;
  const { userId } = gated;

  const body = await req.json().catch(() => ({}) as any);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("crm_organizations")
    .insert({
      bank_id: brokerageBankId,
      name,
      organization_type:
        typeof body?.organizationType === "string" ? body.organizationType : "referral_source",
      website_url: body?.websiteUrl ?? null,
      phone: body?.phone ?? null,
      city: body?.city ?? null,
      state: body?.state ?? null,
      notes: body?.notes ?? null,
      created_by_clerk_user_id: userId,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, organization: data });
}
