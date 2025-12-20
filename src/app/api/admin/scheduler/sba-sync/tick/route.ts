// src/app/api/admin/scheduler/sba-sync/tick/route.ts
import { NextResponse } from "next/server";
import { sbaSyncCore } from "@/lib/sba/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plug this into your existing scheduler (same pattern as other admin ticks).
 * Call it daily (or hourly if you want).
 */
export async function POST() {
  try {
    const res = await sbaSyncCore();
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
