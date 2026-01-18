import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { isSandboxBank } from "@/lib/tenant/sandbox";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function randomUUID() {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Extremely unlikely on modern runtimes, but keep a deterministic fallback.
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const requestId = req.headers.get("x-request-id") || randomUUID();
  try {
    console.log("[api/deals] start", {
      requestId,
      hasClerk: Boolean(process.env.CLERK_SECRET_KEY),
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL),
      hasServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY),
    });

    const bankId = await withTimeout(getCurrentBankId(), 8_000, "getCurrentBankId");
    console.log("[api/deals] bank resolved", { requestId, ms: Date.now() - startedAt });
    const body = await req.json().catch(() => ({}) as any);
    const name = String(body?.name || "").trim();

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "missing_deal_name", request_id: requestId },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServerClient();
    const isDemoBank = await isSandboxBank(bankId).catch(() => false);
    const dealId = randomUUID();

    const baseInsertData: Record<string, any> = {
      id: dealId,
      bank_id: bankId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (isDemoBank) {
      const existing = await supabase
        .from("deals")
        .select("id, borrower_name, created_at")
        .eq("bank_id", bankId)
        .eq("name", name)
        .is("archived_at", null)
        .maybeSingle();

      if (!existing?.error && existing?.data?.id) {
        return NextResponse.json(
          { ok: true, deal: existing.data, dealId: existing.data.id, reused: true, request_id: requestId },
          { status: 200 },
        );
      }
    }

    // Invariant: real production deals must not depend on demo-only schema flags.
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

    type InsertRes = {
      data: { id: string; borrower_name?: string | null; created_at?: string | null } | null;
      error: { message: string } | null;
    };

    const insertOnce = async (payload: Record<string, any>): Promise<InsertRes> => {
      const res = await withTimeout<any>(
        supabase.from("deals").insert(payload).select("id, borrower_name, created_at").single(),
        8_000,
        "insertDeal",
      );

      return {
        data: (res?.data ?? null) as any,
        error: (res?.error ?? null) as any,
      };
    };

    let deal: { id: string; borrower_name?: string | null; created_at?: string | null } | null = null;
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
        { ok: false, error: error?.message || "failed", request_id: requestId },
        { status: 500 },
      );
    }

    console.log("[api/deals] created", {
      requestId,
      dealId: deal.id,
      ms: Date.now() - startedAt,
    });

    return NextResponse.json(
      { ok: true, deal, dealId: deal.id, request_id: requestId },
      { status: 201 },
    );
  } catch (err: any) {
    if (String(err?.message || "").startsWith("timeout:")) {
      return NextResponse.json(
        { ok: false, error: err.message, request_id: requestId },
        { status: 504 },
      );
    }
    if (err?.message?.includes("bank_not_selected")) {
      return NextResponse.json(
        { ok: false, error: "bank_not_selected", request_id: requestId },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err?.message || "failed", request_id: requestId },
      { status: 500 },
    );
  }
}
