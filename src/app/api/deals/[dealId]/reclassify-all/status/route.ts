import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGeminiPromptVersion } from "@/lib/gatekeeper/geminiClassifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/reclassify-all/status
 *
 * Preflight summary for /reclassify-all. Reports:
 * - eligibleDocuments: how many docs would be touched
 * - stalePromptCount: docs classified under a prior prompt version
 * - neverClassifiedCount: docs that never had the gatekeeper run
 * - currentPromptVersion: what version the reclassify would use
 * - hasNewPromptVersion: convenience boolean for the UI gate
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : 403;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const sb = supabaseAdmin();

    const { data: docs, error: docErr } = await (sb as any)
      .from("deal_documents")
      .select("id, gatekeeper_prompt_version, gatekeeper_classified_at, canonical_type")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .not("storage_path", "is", null);

    if (docErr) {
      return NextResponse.json(
        { ok: false, error: `doc_load_failed: ${docErr.message}` },
        { status: 500 },
      );
    }

    const eligible = (docs ?? []) as Array<{
      gatekeeper_prompt_version: string | null;
      gatekeeper_classified_at: string | null;
    }>;
    const currentPromptVersion = getGeminiPromptVersion();

    const stalePromptCount = eligible.filter(
      (d) =>
        d.gatekeeper_prompt_version != null &&
        d.gatekeeper_prompt_version !== currentPromptVersion,
    ).length;
    const neverClassifiedCount = eligible.filter(
      (d) => !d.gatekeeper_classified_at,
    ).length;

    return NextResponse.json({
      ok: true,
      eligibleDocuments: eligible.length,
      stalePromptCount,
      neverClassifiedCount,
      currentPromptVersion,
      hasNewPromptVersion: stalePromptCount > 0 || neverClassifiedCount > 0,
    });
  } catch (error) {
    console.error("[reclassify-all/status] error", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
