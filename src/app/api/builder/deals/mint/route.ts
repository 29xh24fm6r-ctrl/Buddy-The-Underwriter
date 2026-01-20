import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";
import { mintBuilderDealCore } from "@/lib/builder/builderDealsCore";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { resolveBuilderBankId } from "@/lib/builder/resolveBuilderBankId";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function insertDealWithFallback(
  sb: ReturnType<typeof supabaseAdmin>,
  payload: Record<string, any>,
): Promise<{ id: string }> {
  const attempt = await sb.from("deals").insert(payload).select("id").single();
  if (!attempt.error && attempt.data?.id) {
    return { id: String(attempt.data.id) };
  }

  const msg = String(attempt.error?.message ?? "");
  if (!msg.includes("column")) {
    throw attempt.error ?? new Error("deal_insert_failed");
  }

  const fallbackPayload: Record<string, any> = {
    bank_id: payload.bank_id,
    name: payload.name,
    borrower_name: payload.borrower_name,
    created_at: payload.created_at,
    updated_at: payload.updated_at,
  };

  const fallback = await sb.from("deals").insert(fallbackPayload).select("id").single();
  if (fallback.error || !fallback.data?.id) {
    throw fallback.error ?? new Error("deal_insert_failed");
  }

  return { id: String(fallback.data.id) };
}

export async function POST(req: Request) {
  mustBuilderToken(req);
  const sb = supabaseAdmin();

  try {
    const bankId = await resolveBuilderBankId(sb);
    const now = () => new Date().toISOString();

    const result = await mintBuilderDealCore({
      bankId,
      now,
      randomUUID: () => randomUUID(),
      ops: {
        createDeal: (payload) => insertDealWithFallback(sb, payload),
        updateDeal: async () => undefined,
        ensureChecklist: async (dealId, bankIdArg) => {
          await initializeIntake(dealId, bankIdArg, { reason: "builder_mint" });
        },
        markChecklistReceived: async () => undefined,
        ensureFinancialSnapshotDecision: async () => undefined,
        ensureLockedQuote: async () => undefined,
      },
    });

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error: any) {
    console.error("[builder.deals.mint] failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
