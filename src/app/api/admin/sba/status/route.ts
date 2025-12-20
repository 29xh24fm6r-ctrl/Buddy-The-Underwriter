// src/app/api/admin/sba/status/route.ts
import { NextResponse } from "next/server";
import { sbaStatus } from "@/lib/sba/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await sbaStatus();
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
