// src/app/api/borrower/[token]/eligibility/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  evaluateSba7aEligibility,
  extractBorrowerDataFromAnswers,
} from "@/lib/sba7a/eligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * POST /api/borrower/[token]/eligibility
 * Evaluate SBA 7(a) eligibility based on current answers
 *
 * This is called in real-time as borrower answers questions
 * Returns deterministic, explainable eligibility result
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const p = await ctx.params;
    const token = p?.token;

    if (!token) {
      return json(400, { ok: false, error: "Missing token" });
    }

    const body = await req.json();
    const { answers } = body;

    if (!answers || typeof answers !== "object") {
      return json(400, { ok: false, error: "Missing answers object" });
    }

    // Extract borrower data from wizard answers
    const borrowerData = extractBorrowerDataFromAnswers(answers);

    // Evaluate eligibility (deterministic rules engine)
    const eligibility = evaluateSba7aEligibility({ answers });

    console.log("[borrower/eligibility] Token:", token);
    console.log("[borrower/eligibility] Status:", eligibility.status);
    console.log("[borrower/eligibility] Reasons:", eligibility.reasons.length);
    console.log("[borrower/eligibility] Confidence:", eligibility.confidence);

    return json(200, {
      ok: true,
      eligibility,
    });
  } catch (e: any) {
    console.error("[borrower/eligibility] error:", e);
    return json(500, { ok: false, error: e.message });
  }
}
