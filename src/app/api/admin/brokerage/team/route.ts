import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { clerkClient } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { normalizeBuddyRole } from "@/lib/auth/normalizeBuddyRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/team — who's actually on the Buddy Brokerage tenant.
 *
 * This is the piece that was missing: /admin/roles only ever managed
 * global Clerk publicMetadata.role, which requireBrokerageStaff doesn't
 * check for bank_admin/underwriter (only for super_admin) — it checks
 * bank_memberships scoped to this tenant specifically. There was no UI
 * anywhere that wrote to bank_memberships; every teammate added so far
 * (including Matt himself) was done by hand via direct SQL.
 *
 * GET  -> current brokerage team (bank_memberships joined with Clerk user
 *         info) + every Clerk user NOT yet on the tenant, so the page can
 *         offer them as add-candidates
 * POST -> add (or change the role of) a teammate on the brokerage tenant
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

  const { data: memberships, error } = await sb
    .from("bank_memberships")
    .select("id, clerk_user_id, role, created_at")
    .eq("bank_id", brokerageBankId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const client = await clerkClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "Clerk not configured" }, { status: 503 });
  }

  const allUsers = await client.users.getUserList({ limit: 200 });
  const userById = new Map(allUsers.data.map((u) => [u.id, u]));

  const memberUserIds = new Set((memberships ?? []).map((m: any) => m.clerk_user_id));

  const team = (memberships ?? []).map((m: any) => {
    const u = userById.get(m.clerk_user_id);
    return {
      membershipId: m.id,
      clerkUserId: m.clerk_user_id,
      role: normalizeBuddyRole(m.role) ?? m.role,
      addedAt: m.created_at,
      email: u?.emailAddresses?.[0]?.emailAddress ?? null,
      firstName: u?.firstName ?? null,
      lastName: u?.lastName ?? null,
    };
  });

  const candidates = allUsers.data
    .filter((u) => !memberUserIds.has(u.id))
    .map((u) => ({
      clerkUserId: u.id,
      email: u.emailAddresses?.[0]?.emailAddress ?? null,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
    }));

  return NextResponse.json({ ok: true, team, candidates });
}

export async function POST(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const body = await req.json().catch(() => ({}) as any);
  const clerkUserId = typeof body?.clerkUserId === "string" ? body.clerkUserId.trim() : "";
  const role = typeof body?.role === "string" ? body.role : "bank_admin";

  if (!clerkUserId) {
    return NextResponse.json({ ok: false, error: "clerkUserId is required" }, { status: 400 });
  }
  if (role !== "bank_admin" && role !== "underwriter") {
    return NextResponse.json(
      { ok: false, error: "role must be bank_admin or underwriter" },
      { status: 400 },
    );
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bank_memberships")
    .upsert(
      { bank_id: brokerageBankId, clerk_user_id: clerkUserId, role },
      { onConflict: "bank_id,clerk_user_id" },
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, membership: data });
}
