import "server-only";

import { NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brokerage/crm/relationships
 *
 * Cross-cutting view of every external-party-to-deal link (deal_party_roles)
 * for the tenant — the "Relationships" object type from PR1 §3.3. Person-
 * to-organization roles live on the person/org detail pages instead, since
 * those are naturally scoped to one person or one org already.
 */
export async function GET() {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_party_roles")
    .select("*, person:crm_people(first_name,last_name), organization:crm_organizations(name), deal:deals(display_name,borrower_name,name)")
    .eq("bank_id", brokerageBankId)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const relationships = ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    dealId: row.deal_id,
    dealLabel: row.deal?.display_name || row.deal?.borrower_name || row.deal?.name || row.deal_id.slice(0, 8),
    role: row.role,
    personId: row.person_id,
    personName: row.person ? [row.person.first_name, row.person.last_name].filter(Boolean).join(" ") || null : null,
    organizationId: row.organization_id,
    organizationName: row.organization?.name ?? null,
    notes: row.notes,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ ok: true, relationships });
}
