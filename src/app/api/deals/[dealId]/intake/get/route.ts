import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ]);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
  if (!userId)
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );

  const { dealId } = await ctx.params;

  const bankId = await withTimeout(getCurrentBankId(), 8_000, "getCurrentBankId");
  const sb = supabaseAdmin();

  // Tenant enforcement
  const { data: deal, error: dealErr } = await withTimeout(
    sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle(),
    8_000,
    "dealLookup",
  );
  if (dealErr || !deal || deal.bank_id !== bankId) {
    return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
  }

  const { data, error } = await withTimeout(
    sb.from("deal_intake").select("*").eq("deal_id", dealId).maybeSingle(),
    10_000,
    "dealIntakeLoad",
  );

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  // If not present, return defaults (client can upsert)
  return NextResponse.json({
    ok: true,
    intake: data ?? {
      deal_id: dealId,
      loan_type: "CRE",
      sba_program: null,
      borrower_name: null,
      borrower_email: null,
      borrower_phone: null,
    },
  });
}
