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

const GEMINI_MODEL = "gemini-3-flash-preview";

function geminiUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "no_api_key" }, { status: 500 });
    }

    const prompt = `You are a commercial bank underwriter. Return the 3 most likely 6-digit NAICS codes for the following business. Use only real codes from the 2022 NAICS manual.

Company: ${body.company_name ?? "Not specified"}
Description: ${body.business_description}

Return ONLY a valid JSON object — no markdown, no backticks, no preamble:
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
- confidence is 0.0-1.0 decimal
- rationale is one plain-English sentence`;

    const response = await fetch(geminiUrl(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 600,
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`[naics-suggest] Gemini error ${response.status}:`, errText.slice(0, 300));
      return NextResponse.json({ ok: false, error: "ai_error" }, { status: 500 });
    }

    const data = await response.json();

    // thinkingConfig produces thought + answer parts — filter thought parts out
    const text: string =
      data?.candidates?.[0]?.content?.parts
        ?.filter((p: { thought?: boolean }) => !p.thought)
        ?.map((p: { text?: string }) => p.text ?? "")
        ?.join("") ?? "";

    let suggestions: NaicsSuggestion[] = [];
    try {
      const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
      suggestions = JSON.parse(clean).suggestions ?? [];
    } catch {
      console.error("[naics-suggest] JSON parse error. Raw text:", text.slice(0, 300));
      return NextResponse.json({ ok: false, error: "parse_error" }, { status: 500 });
    }

    // Validate shape — drop malformed suggestions
    suggestions = suggestions.filter(
      (s) =>
        typeof s.naics_code === "string" &&
        typeof s.naics_description === "string" &&
        typeof s.confidence === "number" &&
        typeof s.rationale === "string",
    );

    return NextResponse.json({ ok: true, suggestions });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
