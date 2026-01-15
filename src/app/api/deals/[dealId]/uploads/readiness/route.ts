import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "edge";

export const dynamic = "force-dynamic";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ]);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;

    const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await withTimeout(ensureDealBankAccess(dealId), 8_000, "ensureDealBankAccess");
    if (!access.ok) {
      const status =
        access.error === "deal_not_found" ? 404 :
        access.error === "tenant_mismatch" ? 403 :
        400;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const bankId = await withTimeout(getCurrentBankId(), 8_000, "getCurrentBankId");
    const sb = supabaseAdmin();

    const url = new URL(req.url);
    const expectedRaw = url.searchParams.get("expected");
    const expected = expectedRaw ? Math.max(0, parseInt(expectedRaw, 10) || 0) : null;

    const { count, error } = await withTimeout(
      sb
        .from("deal_documents")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId),
      10_000,
      "documentsCount",
    );

    if (error) throw error;

    const persisted = count ?? 0;
    const exp = expected ?? persisted; // if client doesn't pass expected, assume ready
    const remaining = Math.max(0, exp - persisted);
    const ready = remaining === 0;

    return NextResponse.json({
      ok: true,
      dealId,
      bankId,
      expected: exp,
      persisted,
      remaining,
      ready,
    });
  } catch (e: any) {
    const isTimeout = String(e?.message || "").startsWith("timeout:");
    return NextResponse.json(
      { ok: false, error: isTimeout ? "Request timed out" : "Internal server error", details: String(e?.message ?? e) },
      { status: isTimeout ? 504 : 500 }
    );
  }
}
