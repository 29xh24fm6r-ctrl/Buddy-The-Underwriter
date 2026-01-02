import "server-only";
import { NextResponse } from "next/server";
import { clerkClient, isClerkConfigured } from "@/lib/auth/clerkServer";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

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

export async function GET() {
  try {
    requireSuperAdmin();

    const client = await clerkClient();
    const users = await client.users.getUserList({ limit: 100 });

    const rows = users.data.map((u) => ({
      id: u.id,
      email: u.emailAddresses?.[0]?.emailAddress ?? null,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      createdAt: u.createdAt,
      lastSignInAt: u.lastSignInAt ?? null,
      role: (u.publicMetadata as any)?.role ?? null,
    }));

    return NextResponse.json({ ok: true, users: rows });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
