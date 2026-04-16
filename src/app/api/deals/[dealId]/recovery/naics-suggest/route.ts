import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  business_description: z.string().min(10).max(2000),
  company_name: z.string().max(200).optional(),
});

type NaicsSuggestion = {
  naics_code: string;
  naics_description: string;
  confidence: number;
  rationale: string;
};

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "no_api_key" }, { status: 500 });
    }

    const prompt = `You are a commercial bank underwriter. Return the 3 most likely 6-digit NAICS codes
for the following business. Use only real codes from the 2022 NAICS manual.

Company: ${body.company_name ?? "Not specified"}
Description: ${body.business_description}

Return ONLY valid JSON — no markdown, no preamble, no explanation outside the JSON:
{
  "suggestions": [
    {
      "naics_code": "531311",
      "naics_description": "Residential Property Managers",
      "confidence": 0.90,
      "rationale": "One sentence explaining the fit"
    }
  ]
}

Rules:
- Exactly 3 suggestions ordered best-first
- confidence is 0.0–1.0 (decimal, not a string label)
- rationale is one plain-English sentence`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: "ai_error" }, { status: 500 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    let suggestions: NaicsSuggestion[] = [];
    try {
      const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
      suggestions = JSON.parse(clean).suggestions ?? [];
    } catch {
      return NextResponse.json({ ok: false, error: "parse_error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, suggestions, dealId });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
