import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { clerkClient } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { normalizeBuddyRole } from "@/lib/auth/normalizeBuddyRole";
import { ensureUserProfile } from "@/lib/tenant/ensureUserProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/team — who's actually on the Buddy Brokerage tenant.
 *
 * GET  -> current brokerage team (bank_memberships joined with Clerk user
 *         info) + every Clerk user NOT yet on the tenant, so the page can
 *         offer them as add-candidates
 * POST -> add (or change the role of) a teammate on the brokerage tenant
 *
 * IMPORTANT: trg_bank_memberships_fill_user_id (DB trigger) resolves
 * bank_memberships.user_id from profiles.clerk_user_id. A candidate who
 * has only ever signed into Clerk — and never loaded a page that ran
 * getCurrentBankId() for their own session — has no profiles row yet,
 * so the trigger has nothing to match and the insert fails. POST
 * provisions that row here first (same invariant getCurrentBankId
 * follows for its own auto-provision path) so brand-new teammates can
 * be added on the first try.
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

  // Provision profiles row FIRST — trg_bank_memberships_fill_user_id needs
  // it to resolve user_id from clerk_user_id. Without this, adding anyone
  // who hasn't already resolved bank context in their own session fails
  // with "bank_memberships.user_id required: provide user_id, or
  // clerk_user_id matching profiles.clerk_user_id, or use authenticated
  // Supabase session".
  const client = await clerkClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "Clerk not configured" }, { status: 503 });
  }

  let email: string | null = null;
  let name: string | null = null;
  try {
    const targetUser = await client.users.getUser(clerkUserId);
    email =
      targetUser.emailAddresses?.find((e) => e.id === targetUser.primaryEmailAddressId)
        ?.emailAddress ??
      targetUser.emailAddresses?.[0]?.emailAddress ??
      null;
    name = targetUser.firstName
      ? `${targetUser.firstName}${targetUser.lastName ? ` ${targetUser.lastName}` : ""}`
      : null;
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `clerk user lookup failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  const profileResult = await ensureUserProfile({
    userId: clerkUserId,
    bankId: brokerageBankId,
    email,
    name,
  });

  if (!profileResult.ok && profileResult.error === "insert_failed") {
    return NextResponse.json(
      { ok: false, error: `profile provisioning failed: ${profileResult.detail}` },
      { status: 500 },
    );
  }
  // "schema_mismatch" is non-fatal here — the base-columns row still exists
  // and clerk_user_id is set, which is all the trigger needs to resolve
  // user_id. avatar/display_name backfill can happen later.

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
