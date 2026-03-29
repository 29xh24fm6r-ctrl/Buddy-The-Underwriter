import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertCryptoCollateralPosition } from "@/core/relationship/cryptoServices";

export const runtime = "nodejs";

type Params = Promise<{ relationshipId: string }>;

async function ensureRelationshipBankAccess(
  relationshipId: string,
): Promise<{ ok: true; bankId: string; userId: string } | { ok: false }> {
  const { userId } = await clerkAuth();
  if (!userId) return { ok: false };

  const sb = supabaseAdmin();
  const { data: bu } = await sb
    .from("bank_users")
    .select("bank_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!bu) return { ok: false };

  // Verify relationship belongs to this bank
  const { data: rel } = await sb
    .from("relationship_crypto_collateral_positions")
    .select("bank_id")
    .eq("relationship_id", relationshipId)
    .eq("bank_id", bu.bank_id)
    .limit(1)
    .maybeSingle();

  // Allow if no positions yet (creating first one) or bank matches
  if (rel && rel.bank_id !== bu.bank_id) return { ok: false };

  return { ok: true, bankId: bu.bank_id, userId };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { relationshipId } = await ctx.params;
    const access = await ensureRelationshipBankAccess(relationshipId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const result = await upsertCryptoCollateralPosition({
      id: body.id,
      relationshipId,
      bankId: access.bankId,
      dealId: body.dealId,
      assetSymbol: body.assetSymbol,
      custodyProvider: body.custodyProvider,
      custodyAccountRef: body.custodyAccountRef,
      pledgedUnits: body.pledgedUnits,
      eligibleAdvanceRate: body.eligibleAdvanceRate,
      haircutPercent: body.haircutPercent,
      securedExposureUsd: body.securedExposureUsd,
      warningLtvThreshold: body.warningLtvThreshold,
      marginCallLtvThreshold: body.marginCallLtvThreshold,
      liquidationLtvThreshold: body.liquidationLtvThreshold,
      evidence: body.evidence,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
