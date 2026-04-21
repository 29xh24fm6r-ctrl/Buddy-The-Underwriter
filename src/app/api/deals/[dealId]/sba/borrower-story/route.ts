import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  loadBorrowerStory,
  saveBorrowerStory,
  type BorrowerStory,
  type VoiceFormality,
  type CapturedVia,
} from "@/lib/sba/sbaBorrowerStory";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: 403 },
      );
    }

    const story = await loadBorrowerStory(dealId);
    return NextResponse.json({ ok: true, story });
  } catch (err) {
    console.error("[sba/borrower-story][GET] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}

function asTrimmedStringOrNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asVoiceFormality(value: unknown): VoiceFormality | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value === "casual" || value === "professional" || value === "technical") {
    return value;
  }
  return undefined;
}

function asCapturedVia(value: unknown): CapturedVia | undefined {
  if (value === "voice" || value === "chat" || value === "form") return value;
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

export async function PUT(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "invalid_body" },
        { status: 400 },
      );
    }

    const patch: Partial<Omit<BorrowerStory, "dealId" | "capturedAt">> = {};
    const assign = <K extends keyof typeof patch>(
      key: K,
      value: (typeof patch)[K] | undefined,
    ) => {
      if (value !== undefined) patch[key] = value;
    };

    assign("originStory", asTrimmedStringOrNull(body.originStory));
    assign("competitiveInsight", asTrimmedStringOrNull(body.competitiveInsight));
    assign("idealCustomer", asTrimmedStringOrNull(body.idealCustomer));
    assign("growthStrategy", asTrimmedStringOrNull(body.growthStrategy));
    assign("biggestRisk", asTrimmedStringOrNull(body.biggestRisk));
    assign("personalVision", asTrimmedStringOrNull(body.personalVision));
    assign("voiceFormality", asVoiceFormality(body.voiceFormality));
    assign("voiceMetaphors", asStringArray(body.voiceMetaphors));
    assign("voiceValues", asStringArray(body.voiceValues));
    assign("capturedVia", asCapturedVia(body.capturedVia));

    await saveBorrowerStory(dealId, patch);
    const story = await loadBorrowerStory(dealId);
    return NextResponse.json({ ok: true, story });
  } catch (err) {
    console.error("[sba/borrower-story][PUT] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}
