import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/crm/organizations — brokerage CRM command center.
 *
 * Twenty-inspired data model (crm_organizations / crm_people / crm_activities),
 * clean-room implementation scoped to the Buddy Brokerage tenant. See
 * migration crm_core_organizations_people_activities for the schema notes.
 *
 * This route now does real relationship-health and revenue-attribution
 * work, not just a list: per-org last-activity date, deals referred,
 * dollars sourced (via deals.referral_source_org_id — migration
 * crm_deal_attribution), a health status derived from staleness, plus
 * cross-organization "needs attention" / recent activity / open tasks
 * feeds for the command-center dashboard. Previously this endpoint
 * returned a flat list with a people count and nothing else — every
 * organization looked the same regardless of whether it was your best
 * referral source or one you hadn't talked to in four months.
 *
 * GET  -> organizations (enriched) + command-center summary/feeds
 * POST -> create an organization
 */

const STALE_DAYS_WARN = 30;
const STALE_DAYS_COLD = 60;

function healthFor(lastActivityAt: string | null): "active" | "cooling" | "cold" | "new" {
  if (!lastActivityAt) return "new";
  const ageDays = (Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000;
  if (ageDays <= STALE_DAYS_WARN) return "active";
  if (ageDays <= STALE_DAYS_COLD) return "cooling";
  return "cold";
}

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

  const [
    { data: orgs, error: orgErr },
    { data: people, error: peopleErr },
    { data: activities, error: actErr },
    { data: referredDeals, error: dealsErr },
  ] = await Promise.all([
    sb.from("crm_organizations").select("*").eq("bank_id", brokerageBankId).order("name", { ascending: true }),
    sb.from("crm_people").select("id, organization_id").eq("bank_id", brokerageBankId),
    sb
      .from("crm_activities")
      .select("id, kind, title, happens_at, due_at, completed_at, target_organization_id, target_person_id, properties")
      .eq("bank_id", brokerageBankId)
      .order("happens_at", { ascending: false })
      .limit(500),
    sb
      .from("deals")
      .select("id, referral_source_org_id, loan_amount, display_name, borrower_name")
      .eq("bank_id", brokerageBankId)
      .not("referral_source_org_id", "is", null),
  ]);

  if (orgErr || peopleErr || actErr || dealsErr) {
    return NextResponse.json(
      { ok: false, error: orgErr?.message ?? peopleErr?.message ?? actErr?.message ?? dealsErr?.message },
      { status: 500 },
    );
  }

  const peopleByOrg = new Map<string, number>();
  const personToOrg = new Map<string, string>();
  for (const p of people ?? []) {
    if (!p.organization_id) continue;
    peopleByOrg.set(p.organization_id, (peopleByOrg.get(p.organization_id) ?? 0) + 1);
    personToOrg.set(p.id, p.organization_id);
  }

  // Resolve every activity to an org (directly, or via the person it's logged against).
  function orgIdForActivity(a: any): string | null {
    if (a.target_organization_id) return a.target_organization_id as string;
    if (a.target_person_id) return personToOrg.get(a.target_person_id) ?? null;
    return null;
  }

  const lastActivityByOrg = new Map<string, string>();
  const openTasks: any[] = [];
  const recentActivity: any[] = [];

  for (const a of activities ?? []) {
    const orgId = orgIdForActivity(a);
    if (orgId) {
      const existing = lastActivityByOrg.get(orgId);
      if (!existing || new Date(a.happens_at) > new Date(existing)) {
        lastActivityByOrg.set(orgId, a.happens_at);
      }
    }
    if (recentActivity.length < 20) {
      recentActivity.push({ ...a, organizationId: orgId });
    }
    if (a.kind === "task" && !a.completed_at) {
      openTasks.push({ ...a, organizationId: orgId });
    }
  }
  openTasks.sort((x, y) => {
    if (!x.due_at) return 1;
    if (!y.due_at) return -1;
    return new Date(x.due_at).getTime() - new Date(y.due_at).getTime();
  });

  const dealsByOrg = new Map<string, { count: number; value: number }>();
  for (const d of referredDeals ?? []) {
    if (!d.referral_source_org_id) continue;
    const cur = dealsByOrg.get(d.referral_source_org_id) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(d.loan_amount ?? 0);
    dealsByOrg.set(d.referral_source_org_id, cur);
  }

  const orgNameById = new Map((orgs ?? []).map((o: any) => [o.id, o.name]));

  const result = (orgs ?? []).map((o: any) => {
    const lastActivityAt = lastActivityByOrg.get(o.id) ?? null;
    const deals = dealsByOrg.get(o.id) ?? { count: 0, value: 0 };
    return {
      ...o,
      peopleCount: peopleByOrg.get(o.id) ?? 0,
      lastActivityAt,
      health: healthFor(lastActivityAt),
      dealsReferredCount: deals.count,
      dealsReferredValue: deals.value,
    };
  });

  const needsAttention = result
    .filter((o: any) => o.health === "cooling" || o.health === "cold")
    .sort((a: any, b: any) => (a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? ""))
    .slice(0, 8);

  const totalDealsReferred = (referredDeals ?? []).length;
  const totalValueSourced = (referredDeals ?? []).reduce((s, d: any) => s + Number(d.loan_amount ?? 0), 0);

  return NextResponse.json({
    ok: true,
    organizations: result,
    summary: {
      organizationCount: (orgs ?? []).length,
      contactCount: (people ?? []).length,
      dealsReferredCount: totalDealsReferred,
      valueSourced: totalValueSourced,
      needsAttentionCount: needsAttention.length,
    },
    needsAttention,
    recentActivity: recentActivity.map((a) => ({ ...a, organizationName: a.organizationId ? orgNameById.get(a.organizationId) ?? null : null })),
    openTasks: openTasks.map((t) => ({ ...t, organizationName: t.organizationId ? orgNameById.get(t.organizationId) ?? null : null })),
  });
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
