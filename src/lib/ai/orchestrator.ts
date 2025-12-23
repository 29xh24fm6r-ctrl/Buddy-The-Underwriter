import OpenAI from "openai";
import { AIPilotResponse, type AIPilotResponseT } from "./schemas";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeJsonParse(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false as const, error: e };
  }
}

/**
 * Minimal "AI Pilot" – outputs strict JSON ONLY.
 * You will wire real deal/docs state into `context` over time.
 */
export async function runAIPilot(params: {
  userIntent: string;
  dealId?: string | null;
  context?: Record<string, any>;
}): Promise<AIPilotResponseT> {
  const { userIntent, dealId, context } = params;

  const system = `
You are "Buddy AI Pilot" for a commercial underwriting platform.
Your job: produce a plan + allowed typed actions that move the deal forward.
Rules:
- Output MUST be valid JSON only. No markdown. No commentary.
- Only use these action types:
  REQUEST_DOCUMENT, CREATE_TASK, FLAG_RISK, ADD_CONDITION, SET_DEAL_STATUS, GENERATE_PDF
- Never invent documents. If missing, REQUEST_DOCUMENT.
- Prefer TIER_2 authority. Use TIER_3 only for approvals or borrower-facing sends.
- If uncertain, add warnings and lower confidence.
Return JSON with keys: summary, plan, actions, confidence, evidence, warnings
`;

  const user = {
    userIntent,
    dealId: dealId ?? null,
    context: context ?? {},
  };

  // Attempt 1: normal
  const r1 = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system.trim() },
      { role: "user", content: JSON.stringify(user) },
    ],
  });

  const text1 = r1.choices?.[0]?.message?.content?.trim() ?? "";
  const p1 = safeJsonParse(text1);

  if (p1.ok) {
    const v = AIPilotResponse.safeParse(p1.value);
    if (v.success) return v.data;
  }

  // Attempt 2: "fix to schema"
  const r2 = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system.trim() },
      {
        role: "user",
        content:
          "Fix the following into valid JSON that matches the required schema. Output JSON only:\n" +
          text1,
      },
    ],
  });

  const text2 = r2.choices?.[0]?.message?.content?.trim() ?? "";
  const p2 = safeJsonParse(text2);

  if (p2.ok) {
    const v = AIPilotResponse.safeParse(p2.value);
    if (v.success) return v.data;
  }

  // Final safe fallback
  return {
    summary: "AI Pilot could not produce a valid structured response. Please try again.",
    plan: ["Retry the request", "If it fails again, reduce the scope of the intent"],
    actions: [],
    confidence: 0.2,
    evidence: [],
    warnings: ["Schema validation failed twice."],
  };
}
