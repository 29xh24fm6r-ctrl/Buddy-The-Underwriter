import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createPerson } from "@/lib/crm/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/crm/people
 *
 * GET  -> list all people for the tenant (optionally filtered by
 *         organizationId or a `q` search term), excluding merged records.
 * POST -> create a person, optionally linked to an organization.
 */

async function gate(): Promise<{ userId: string } | NextResponse> {
  try {
    return await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
}

export async function GET(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const organizationId = req.nextUrl.searchParams.get("organizationId");
  const q = req.nextUrl.searchParams.get("q");

  let query = sb
    .from("crm_people")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .is("merged_into_id", null)
    .order("last_name", { ascending: true })
    .limit(500);

  if (organizationId) query = query.eq("organization_id", organizationId);
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const people = data ?? [];
  const personIds = people.map((person) => person.id);
  const { data: roles, error: roleError } = personIds.length
    ? await sb.from("crm_person_organization_roles").select("person_id, organization_id, role, job_title").eq("bank_id", brokerageBankId).in("person_id", personIds)
    : { data: [], error: null };
  if (roleError) return NextResponse.json({ ok: false, error: roleError.message }, { status: 500 });
  const organizationIds = Array.from(new Set([
    ...people.map((person) => person.organization_id).filter(Boolean),
    ...(roles ?? []).map((role) => role.organization_id).filter(Boolean),
  ]));
  const { data: organizations, error: organizationError } = organizationIds.length
    ? await sb.from("crm_organizations").select("id, name").eq("bank_id", brokerageBankId).in("id", organizationIds)
    : { data: [], error: null };
  if (organizationError) return NextResponse.json({ ok: false, error: organizationError.message }, { status: 500 });
  const organizationNames = new Map((organizations ?? []).map((organization) => [organization.id, organization.name]));
  const rolesByPerson = new Map<string, Array<{ organizationId: string; organizationName: string; role: string | null; jobTitle: string | null }>>();
  for (const role of roles ?? []) {
    const connection = { organizationId: role.organization_id, organizationName: organizationNames.get(role.organization_id) ?? "Unknown company", role: role.role ?? null, jobTitle: role.job_title ?? null };
    rolesByPerson.set(role.person_id, [...(rolesByPerson.get(role.person_id) ?? []), connection]);
  }

  return NextResponse.json({
    ok: true,
    people: people.map((person) => ({
      ...person,
      organization_name: person.organization_id ? organizationNames.get(person.organization_id) ?? null : null,
      connections: rolesByPerson.get(person.id) ?? [],
    })),
  });
}

export async function POST(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;
  const { userId } = gated;

  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  try {
    const person = await createPerson({
      bankId: brokerageBankId,
      firstName: body?.firstName ?? null,
      lastName: body?.lastName ?? null,
      preferredName: body?.preferredName ?? null,
      email: body?.email ?? null,
      phone: body?.phone ?? null,
      mobilePhone: body?.mobilePhone ?? null,
      jobTitle: body?.jobTitle ?? null,
      linkedinUrl: body?.linkedinUrl ?? null,
      communicationPreference: body?.communicationPreference ?? null,
      relationshipOwnerClerkUserId: body?.relationshipOwnerClerkUserId ?? null,
      notes: body?.notes ?? null,
      createdByClerkUserId: userId,
      organizationId: typeof body?.organizationId === "string" ? body.organizationId : null,
      organizationRole: body?.organizationRole,
    });
    return NextResponse.json({ ok: true, person });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
