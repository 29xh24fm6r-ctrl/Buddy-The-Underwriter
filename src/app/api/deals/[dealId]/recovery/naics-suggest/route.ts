import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { runRole } from "@/lib/ai/gateway";

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

// SPEC-M1 AI-GATEWAY-1 proof-of-concept migration: this route is the first
// call site moved onto the gateway (chosen in §0 as the lowest-risk
// candidate — single call, strict JSON in/out, non-critical recovery
// flow, no downstream dependents). The other 17 direct Gemini call sites
// found in §0 are unaffected and tracked on the guard-ai-gateway-only
// allowlist as M1.1 follow-up debt.
const SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          naics_code: { type: "string" },
          naics_description: { type: "string" },
          confidence: { type: "number" },
          rationale: { type: "string" },
        },
        required: ["naics_code", "naics_description", "confidence", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

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

    const prompt = `You are a commercial bank underwriter. Return the 3 most likely 6-digit NAICS codes for the following business. Use only real codes from the 2022 NAICS manual.

Company: ${body.company_name ?? "Not specified"}
Description: ${body.business_description}

Rules:
- Exactly 3 suggestions ordered best-first
- confidence is 0.0-1.0 decimal
- rationale is one plain-English sentence`;

    let text: string;
    try {
      const result = await runRole("generator", {
        prompt,
        maxOutputTokens: 600,
        responseSchema: SUGGESTIONS_SCHEMA,
        purpose: "naics_suggest",
        dealId,
        // Company name + business description are business facts a broker
        // would post publicly, not borrower personal NPI (SSN/income/tax
        // data) — no NPI gate applies here.
        npiTagged: false,
      });
      text = result.text;
    } catch (e) {
      console.error(
        "[naics-suggest] gateway error:",
        e instanceof Error ? e.message : String(e),
      );
      return NextResponse.json({ ok: false, error: "ai_error" }, { status: 500 });
    }

    let suggestions: NaicsSuggestion[] = [];
    try {
      suggestions = JSON.parse(text).suggestions ?? [];
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
