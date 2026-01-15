// src/app/api/admin/schema/discover/route.ts
import { NextResponse } from "next/server";
import { discoverSchema } from "@/lib/admin/schemaDiscovery";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin endpoint: discover likely OCR text / receipt / checklist tables
 * Returns top candidates ranked by heuristic scoring
 */
export async function GET() {
  try {
    await requireSuperAdmin();
    const res = await discoverSchema();
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg === "unauthorized") return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (msg === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    return NextResponse.json(
      { ok: false, error: msg || "Unknown error" },
      { status: 500 },
    );
  }
}
