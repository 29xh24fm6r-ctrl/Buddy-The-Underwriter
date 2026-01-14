// src/app/api/admin/scheduler/sba-sync/tick/route.ts
import { NextResponse } from "next/server";
import { sbaSyncCore } from "@/lib/sba/sync";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function enforceSuperAdmin() {
  try {
    await requireSuperAdmin();
    return null;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "unauthorized")
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    if (msg === "forbidden")
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * Plug this into your existing scheduler (same pattern as other admin ticks).
 * Call it daily (or hourly if you want).
 */
export async function POST() {
  try {
    const auth = await enforceSuperAdmin();
    if (auth) return auth;

    const res = await sbaSyncCore();
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
