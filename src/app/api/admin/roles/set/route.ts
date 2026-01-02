import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clerkClient, isClerkConfigured } from "@/lib/auth/clerkServer";
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
    requireSuperAdmin();

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id ?? "");
    const role = body?.role;

    if (!userId)
      return NextResponse.json(
        { ok: false, error: "user_id is required" },
        { status: 400 },
      );
    if (!isBuddyRole(role))
      return NextResponse.json(
        { ok: false, error: "invalid role" },
        { status: 400 },
      );

    const client = await clerkClient();
    await client.users.updateUser(userId, {
      publicMetadata: { role },
    });

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
