// src/app/api/admin/schema/discover/route.ts
import { NextResponse } from "next/server";
import { discoverSchema } from "@/lib/admin/schemaDiscovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin endpoint: discover likely OCR text / receipt / checklist tables
 * Returns top candidates ranked by heuristic scoring
 */
export async function GET() {
  try {
    const res = await discoverSchema();
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
