import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getProductTypesForBank } from "@/lib/loanRequests/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    let bankId = req.nextUrl.searchParams.get("bankId") || null;

    // Auto-resolve bank_id from authenticated banker context if not provided
    if (!bankId) {
      try {
        const { getCurrentBankId } = await import(
          "@/lib/tenant/getCurrentBankId"
        );
        bankId = await getCurrentBankId();
      } catch {
        // Non-fatal — caller may not be authenticated (e.g. public context)
      }
    }

    const productTypes = await getProductTypesForBank(bankId);
    return NextResponse.json({ ok: true, productTypes });
  } catch (e: any) {
    console.error("[loan-product-types GET]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
