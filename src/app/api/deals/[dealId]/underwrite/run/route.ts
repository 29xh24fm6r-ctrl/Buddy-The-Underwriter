import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { runFullUnderwrite } from "@/lib/underwritingEngine";
import { loadDealModel } from "@/lib/underwritingEngine/loaders/loadDealModel";
import { loadDealInstruments } from "@/lib/underwritingEngine/loaders/loadDealInstruments";
import { loadActiveBankConfig } from "@/lib/configEngine";
import { createUnderwriteArtifact } from "@/lib/artifactEngine";
import type { ProductType } from "@/lib/creditLenses/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// Product type resolution
// ---------------------------------------------------------------------------

const PRODUCT_TYPE_MAP: Record<string, ProductType> = {
  SBA: "SBA",
  "SBA 7(a)": "SBA",
  "SBA 504": "SBA",
  LOC: "LOC",
  "LINE OF CREDIT": "LOC",
  EQUIPMENT: "EQUIPMENT",
  ACQUISITION: "ACQUISITION",
  CRE: "CRE",
  "COMMERCIAL REAL ESTATE": "CRE",
  CONVENTIONAL: "CRE",
};

async function resolveProductType(dealId: string): Promise<ProductType> {
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("deal_loan_requests")
    .select("product_type")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const raw = (data?.product_type ?? "SBA").toUpperCase();
  return PRODUCT_TYPE_MAP[raw] ?? "SBA";
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(_req: Request, ctx: Ctx) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    // Load inputs
    const [model, instruments, bankConfig, product] = await Promise.all([
      loadDealModel(dealId),
      loadDealInstruments(dealId),
      loadActiveBankConfig(access.bankId),
      resolveProductType(dealId),
    ]);

    // Run pipeline
    const result = runFullUnderwrite({
      model,
      product,
      instruments: instruments.length > 0 ? instruments : undefined,
      bankConfig: bankConfig ?? undefined,
    });

    if (!result.diagnostics.pipelineComplete) {
      const failure = result as { diagnostics: { reason: string } };
      return NextResponse.json(
        { ok: false, error: failure.diagnostics.reason },
        { status: 422 },
      );
    }

    // Persist artifact
    const artifact = await createUnderwriteArtifact({
      dealId,
      bankId: access.bankId,
      result: result as import("@/lib/underwritingEngine/types").UnderwriteResult,
      model,
      instruments: instruments.length > 0 ? instruments : undefined,
      bankConfigVersionId: bankConfig?.id,
      createdBy: access.userId,
    });

    if (!artifact.ok) {
      return NextResponse.json(
        { ok: false, error: artifact.error },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      artifactId: artifact.artifactId,
      version: artifact.version,
      overallHash: artifact.overallHash,
    });
  } catch (err) {
    console.error("[underwrite/run]", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
