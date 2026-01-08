import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

export async function POST(req: Request) {
  try {
    const bankId = await withTimeout(getCurrentBankId(), 12_000, "getCurrentBankId");
    const body = await req.json().catch(() => ({}) as any);
    const name = String(body?.name || "").trim();

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "missing_deal_name" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServerClient();
    const dealId = crypto.randomUUID();

    const baseInsertData: Record<string, any> = {
      id: dealId,
      bank_id: bankId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Optional fields that may not exist in older schemas
    const optimisticInsertData: Record<string, any> = {
      ...baseInsertData,
      ...(name
        ? {
            name,
            borrower_name: name,
          }
        : null),
      stage: "intake",
      entity_type: "Unknown",
      risk_score: 0,
    };

    type InsertRes = { data: { id: string } | null; error: { message: string } | null };

    const insertOnce = async (payload: Record<string, any>): Promise<InsertRes> => {
      const res = await withTimeout<any>(
        supabase.from("deals").insert(payload).select("id").single(),
        15_000,
        "insertDeal",
      );

      return {
        data: (res?.data ?? null) as any,
        error: (res?.error ?? null) as any,
      };
    };

    let deal: { id: string } | null = null;
    let error: { message: string } | null = null;

    {
      const res = await insertOnce(optimisticInsertData);
      deal = res.data;
      error = res.error;
    }
    if (error) {
      const msg = String(error?.message || "");
      const schemaMaybeMissing =
        msg.includes("column") &&
        (msg.includes("stage") || msg.includes("entity_type") || msg.includes("risk_score"));

      if (schemaMaybeMissing) {
        const fallbackPayload: Record<string, any> = {
          ...baseInsertData,
          ...(name
            ? {
                name,
                borrower_name: name,
              }
            : null),
        };
        const res = await insertOnce(fallbackPayload);
        deal = res.data;
        error = res.error;
      }
    }

    if (error || !deal?.id) {
      return NextResponse.json(
        { ok: false, error: error?.message || "failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, dealId: deal.id }, { status: 201 });
  } catch (err: any) {
    if (String(err?.message || "").startsWith("timeout:")) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 504 },
      );
    }
    if (err?.message?.includes("bank_not_selected")) {
      return NextResponse.json(
        { ok: false, error: "bank_not_selected" },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err?.message || "failed" },
      { status: 500 },
    );
  }
}
