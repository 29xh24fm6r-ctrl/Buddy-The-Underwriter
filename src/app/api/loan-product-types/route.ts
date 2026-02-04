import "server-only";
import { NextResponse } from "next/server";
import { getProductTypes } from "@/lib/loanRequests/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const productTypes = await getProductTypes();
    return NextResponse.json({ ok: true, productTypes });
  } catch (e: any) {
    console.error("[loan-product-types GET]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
