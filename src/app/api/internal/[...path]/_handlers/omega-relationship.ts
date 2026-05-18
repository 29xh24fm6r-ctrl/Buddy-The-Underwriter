import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateOmegaExplanation } from "@/core/omega/generateOmegaExplanation";
import { MODEL_OMEGA } from "@/lib/ai/models";
import { generateOmegaRecommendations } from "@/core/omega/generateOmegaRecommendations";
import { generateOmegaRiskNarrative } from "@/core/omega/generateOmegaRiskNarrative";
import { generateOmegaCommunication } from "@/core/omega/generateOmegaCommunication";
import { generateOmegaScenarios } from "@/core/omega/generateOmegaScenarios";
import type { OmegaRelationshipContext } from "@/core/omega/relationshipAdvisoryTypes";
import type { RelationshipSurfaceItem } from "@/core/relationship-surface/types";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/omega/relationship
 * Generate Omega advisory for a single relationship.
 * Body: { relationshipId: string }
 *
 * HARD RULE: This route NEVER writes to canonical tables.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();
    const { data: bu } = await sb
      .from("bank_users")
      .select("bank_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!bu) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const relationshipId = body.relationshipId;
    if (!relationshipId) {
      return NextResponse.json({ ok: false, error: "relationshipId required" }, { status: 400 });
    }

    // Load surface snapshot for context
    const { data: snapshot } = await sb
      .from("relationship_surface_snapshots")
      .select("surface_payload")
      .eq("relationship_id", relationshipId)
      .eq("bank_id", bu.bank_id)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const surfaceItem = snapshot?.surface_payload as unknown as RelationshipSurfaceItem | null;

    if (!surfaceItem) {
      return NextResponse.json({ ok: false, error: "No surface data available for this relationship." }, { status: 404 });
    }

    // Build Omega context from canonical data only
    const ctx: OmegaRelationshipContext = {
      relationship: surfaceItem,
      canonicalFacts: {
        relationshipState: surfaceItem.canonicalState,
        blockers: surfaceItem.supportingActions.map((a) => a.label),
        nextActions: surfaceItem.primaryActionCode ? [surfaceItem.primaryActionCode] : [],
        health: surfaceItem.health,
      },
      signals: {},
      evidence: surfaceItem.supportingActions.map((a) => a.evidence),
      timeline: surfaceItem.timelinePreview,
      openCases: surfaceItem.openCases,
    };

    // Run all generators in parallel
    const [explanation, recommendations, riskNarrative, communication, scenarios] =
      await Promise.all([
        generateOmegaExplanation(ctx),
        generateOmegaRecommendations(ctx),
        generateOmegaRiskNarrative(ctx),
        generateOmegaCommunication(ctx),
        generateOmegaScenarios(ctx),
      ]);

    const hasher = createHash("sha256");
    hasher.write(JSON.stringify(ctx.canonicalFacts));
    hasher.end();
    const contextHash = hasher.digest("hex").slice(0, 16);

    return NextResponse.json({
      ok: true,
      advisory: {
        explanation,
        recommendations,
        riskNarrative,
        communication,
        scenarios,
        meta: {
          advisory: true,
          generatedAt: new Date().toISOString(),
          contextHash,
          model: MODEL_OMEGA,
        },
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
