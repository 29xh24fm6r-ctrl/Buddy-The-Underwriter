import "server-only";

// src/app/api/deals/[dealId]/sba/chat-refine/route.ts
// Phase 3 — Conversational assumption refinement. The borrower types a
// natural-language message; Gemini Pro extracts structured patches and a
// conversational reply. The client applies the patches to local state —
// persistence happens when the borrower confirms.

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { callGeminiJSON } from "@/lib/sba/sbaPackageNarrative";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

const MAX_HISTORY = 10;

type ChatBody = {
  message?: unknown;
  currentAssumptions?: unknown;
  conversationHistory?: unknown;
};

export async function POST(req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: 403 },
    );
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { ok: false, error: "Message is required" },
      { status: 400 },
    );
  }

  const currentAssumptions = body.currentAssumptions ?? null;
  const rawHistory = Array.isArray(body.conversationHistory)
    ? body.conversationHistory
    : [];
  const history = rawHistory
    .slice(-MAX_HISTORY)
    .filter(
      (h): h is { role: string; content: string } =>
        typeof h === "object" &&
        h !== null &&
        typeof (h as { role?: unknown }).role === "string" &&
        typeof (h as { content?: unknown }).content === "string",
    );

  const historyBlock = history.length
    ? history
        .map(
          (h) =>
            `${h.role === "buddy" ? "Buddy" : h.role === "user" ? "Borrower" : h.role}: ${h.content}`,
        )
        .join("\n")
    : "(no prior messages)";

  const prompt = `You are Buddy, an expert SBA business plan consultant. The borrower is refining their business plan assumptions through a conversational interface. Extract any specific changes from their message and return both a warm, professional conversational reply AND structured JSON patches to apply to their assumptions.

Rules:
- Be warm and professional. Explain WHY you're making each change, concisely.
- Do NOT invent market statistics or use superlatives.
- If the user is asking a question (not making a change), reply without producing patches.
- Patches use dotted paths that match the SBAAssumptions type exactly, e.g. "revenueStreams[0].growthRateYear1", "costAssumptions.cogsPercentYear1", "workingCapital.targetDSO", "loanImpact.interestRate", "loanImpact.equityInjectionAmount", "managementTeam[0].bio". Numeric values should be numbers (decimals for percentages, e.g. 0.2 for 20%). Do not invent array indices that don't already exist.
- "sectionConfirmed" should be set to one of "revenue", "costs", "workingCapital", "loan", "management" ONLY when the borrower explicitly approves that section in the current message (e.g. "looks good", "keep that"). Otherwise null.

=== CURRENT ASSUMPTIONS (JSON) ===
${JSON.stringify(currentAssumptions, null, 2)}

=== CONVERSATION HISTORY (oldest → newest) ===
${historyBlock}

=== BORROWER'S NEW MESSAGE ===
${message}

=== RESPONSE FORMAT ===
Return ONLY valid JSON:
{
  "reply": "<your conversational response, 1-3 sentences>",
  "patches": [{"path": "revenueStreams[0].growthRateYear1", "value": 0.2}, ...],
  "sectionConfirmed": "revenue" | "costs" | "workingCapital" | "loan" | "management" | null
}`;

  let parsed: {
    reply?: string;
    patches?: unknown;
    sectionConfirmed?: unknown;
  };
  try {
    const raw = await callGeminiJSON(prompt);
    let stripped = raw.trim();
    if (stripped.startsWith("```")) {
      stripped = stripped
        .replace(/^```(?:json)?\s*/, "")
        .replace(/```\s*$/, "");
    }
    parsed = JSON.parse(stripped);
  } catch (err) {
    console.error("[sba/chat-refine] Gemini call failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Could not process that message. Please try again.",
      },
      { status: 502 },
    );
  }

  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim().length > 0
      ? parsed.reply
      : "Got it.";
  const rawPatches = Array.isArray(parsed.patches) ? parsed.patches : [];
  const patches = rawPatches.filter(
    (p): p is { path: string; value: unknown } =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as { path?: unknown }).path === "string",
  );
  const sectionConfirmed =
    typeof parsed.sectionConfirmed === "string" &&
    ["revenue", "costs", "workingCapital", "loan", "management"].includes(
      parsed.sectionConfirmed,
    )
      ? parsed.sectionConfirmed
      : null;

  return NextResponse.json({
    ok: true,
    reply,
    patches,
    sectionConfirmed,
  });
}
