import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadArtifactById } from "@/lib/artifactEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; artifactId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId, artifactId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const artifact = await loadArtifactById(artifactId);

    if (!artifact) {
      return NextResponse.json(
        { ok: false, error: "Artifact not found" },
        { status: 404 },
      );
    }

    // Ensure artifact belongs to this deal (tenant isolation)
    if (artifact.dealId !== dealId) {
      return NextResponse.json(
        { ok: false, error: "Artifact not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, artifact });
  } catch (err) {
    console.error("[underwrite/artifacts/detail]", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
