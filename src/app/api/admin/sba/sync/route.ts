// src/app/api/admin/sba/sync/route.ts
import { NextResponse } from "next/server";
import { syncSBASources, syncSBARuleIndex } from "@/lib/sba/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin endpoint to sync SBA knowledge store
 * In production: run this on a schedule (nightly or weekly)
 */
export async function POST(req: Request) {
  try {
    // TODO: Add admin auth check
    // const adminUser = await requireBankAdmin(req);

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
