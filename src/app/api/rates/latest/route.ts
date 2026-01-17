import { NextResponse } from "next/server";
import { getLatestIndexRates } from "@/lib/rates/indexRates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rates = await getLatestIndexRates();
    return NextResponse.json({ ok: true, rates });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown error" },
      { status: 500 },
    );
  }
}
