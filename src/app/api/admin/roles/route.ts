import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@/lib/auth/clerkServer";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { isBuddyRole } from "@/lib/auth/roles";

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

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin();

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id ?? "");
    const roleRaw = body?.role;
    const role = roleRaw === "" || roleRaw === null || roleRaw === undefined ? null : roleRaw;

    if (!userId)
      return NextResponse.json(
        { ok: false, error: "user_id is required" },
        { status: 400 },
      );
    if (role !== null && !isBuddyRole(role))
      return NextResponse.json(
        { ok: false, error: "invalid role" },
        { status: 400 },
      );

    const client = await clerkClient();
    if (!client) {
      return NextResponse.json(
        { ok: false, error: "Clerk not configured" },
        { status: 503 },
      );
    }
    const existing = await client.users.getUser(userId);
    const publicMetadata = { ...(existing.publicMetadata as any) } as Record<string, any>;
    if (role === null) {
      delete publicMetadata.role;
    } else {
      publicMetadata.role = role;
    }

    await client.users.updateUser(userId, { publicMetadata });

    return NextResponse.json({ ok: true, user_id: userId, role });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
