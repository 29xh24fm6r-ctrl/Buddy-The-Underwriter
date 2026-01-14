// src/app/api/admin/sba/sync/route.ts
import { NextResponse } from "next/server";
import { syncSBASources, syncSBARuleIndex } from "@/lib/sba/sync";
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
 * Admin endpoint to sync SBA knowledge store
 * In production: run this on a schedule (nightly or weekly)
 */
export async function POST(req: Request) {
  try {
    const auth = await enforceSuperAdmin();
    if (auth) return auth;

    const sources = await syncSBASources();
    const rules = await syncSBARuleIndex();

    return NextResponse.json({
      ok: true,
      sourcesSynced: sources.length,
      rulesSynced: rules.length,
      message: "SBA knowledge store updated successfully",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Sync failed" },
      { status: 500 },
    );
  }
}
