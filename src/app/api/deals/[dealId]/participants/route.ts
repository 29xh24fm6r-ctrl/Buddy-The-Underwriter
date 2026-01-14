import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getDealParticipants,
  getUserRoleOnDeal,
  registerBorrowerParticipant,
  registerUnderwriterParticipant,
} from "@/lib/deals/participants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authzError(err: any) {
  const msg = String(err?.message ?? err);
  if (msg === "unauthorized")
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (msg === "forbidden")
    return { status: 403, body: { ok: false, error: "forbidden" } };
  return null;
}

function isSuperAdminAllowlist(userId: string) {
  const allow = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.includes(userId);
}

async function requireAnyParticipant(dealId: string) {
  const { userId } = await clerkAuth();
  if (!userId) throw new Error("unauthorized");

  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from("deal_participants")
    .select("id")
    .eq("deal_id", dealId)
    .eq("clerk_user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("forbidden");

  return { userId };
}

/**
 * GET /api/deals/[dealId]/participants
 *
 * Deal-scoped participants list for UI cards/modals.
 * Any active participant (borrower/underwriter/bank_admin) can read.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    await requireAnyParticipant(dealId);

    const participants = await getDealParticipants(dealId);

    return NextResponse.json({
      ok: true,
      participants: (participants ?? []).map((p: any) => ({
        deal_id: dealId,
        clerk_user_id: p.clerk_user_id,
        role: p.role,
        is_active: true,
        updated_at: p.updated_at ?? null,
      })),
    });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}

type PostBody = {
  user_id?: string;
  role?: "underwriter" | "borrower";
};

/**
 * POST /api/deals/[dealId]/participants
 *
 * Assign an underwriter/borrower participant.
 * Restricted to:
 * - super_admin allowlist OR
 * - an active deal participant with role=bank_admin
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;

    const { userId: actorUserId } = await clerkAuth();
    if (!actorUserId) throw new Error("unauthorized");

    const actorIsSuperAdmin = isSuperAdminAllowlist(actorUserId);
    if (!actorIsSuperAdmin) {
      const actorRole = await getUserRoleOnDeal(dealId, actorUserId);
      if (actorRole !== "bank_admin") throw new Error("forbidden");
    }

    const body = (await req.json().catch(() => ({}))) as PostBody;
    const targetUserId = String(body?.user_id ?? "").trim();
    const role = body?.role;

    if (!targetUserId) {
      return NextResponse.json(
        { ok: false, error: "user_id is required" },
        { status: 400 },
      );
    }

    if (role !== "underwriter" && role !== "borrower") {
      return NextResponse.json(
        { ok: false, error: "role must be underwriter or borrower" },
        { status: 400 },
      );
    }

    if (role === "underwriter") {
      await registerUnderwriterParticipant(dealId, targetUserId, actorUserId);
    } else {
      await registerBorrowerParticipant(dealId, targetUserId);
    }

    const participants = await getDealParticipants(dealId);

    return NextResponse.json({
      ok: true,
      participants: (participants ?? []).map((p: any) => ({
        deal_id: dealId,
        clerk_user_id: p.clerk_user_id,
        role: p.role,
        is_active: true,
        updated_at: p.updated_at ?? null,
      })),
    });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
