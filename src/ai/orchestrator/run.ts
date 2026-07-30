// TODO Phase 23: evaluate Gemini 2.5 Pro for reasoning workloads
//
// SPEC-M1.1 — migrated onto the AI gateway (src/lib/ai/gateway.ts). Same
// OpenAI models (OPENAI_MINI / OPENAI_REASONING), same strict json_schema
// structured-output contract, same "deep_reasoning" runtime toggle — now
// via runRole("structurer", { modelOverride }) instead of a direct OpenAI
// SDK call, so this call is ledgered and NPI-gated like every other
// gateway caller.
import { z } from "zod";
import { OPENAI_MINI, OPENAI_REASONING } from "@/lib/ai/models";
import { runRole } from "@/lib/ai/gateway";

// ---- 1) Contract: the structured output schema (start small)
export const UnderwritingDecisionSchema = z.object({
  decision: z.enum(["approve", "approve_with_conditions", "decline", "needs_more_info"]),
  summary: z.string(),
  key_risks: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  missing_info: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export type UnderwritingDecision = z.infer<typeof UnderwritingDecisionSchema>;

// ---- 2) Model routing
export function pickModel(task: "default" | "deep_reasoning") {
  // default: fast & strong structured outputs
  // deep_reasoning: o1-preview for complex analysis
  return task === "deep_reasoning" ? OPENAI_REASONING : OPENAI_MINI;
}

// ---- 3) Strict structured output call
export async function runUnderwritingDecision(args: {
  task?: "default" | "deep_reasoning";
  input: {
    dealId?: string;
    borrowerName?: string;
    narrative: string; // the core text (paste from UI)
  };
  userId?: string; // for logging
}) {
  const model = pickModel(args.task ?? "default");
  const startTime = Date.now();

  try {
    // NOTE: Structured outputs via json_schema with strict: true
    // ensures the model returns JSON that matches schema
    const result = await runRole("structurer", {
      modelOverride: model,
      purpose: "underwriting_decision",
      dealId: args.input.dealId ?? null,
      systemInstruction:
        "You are Buddy The Underwriter. Be concise, evidence-first, and practical. " +
        "Return only valid JSON matching the schema.",
      prompt:
        `Deal context:\n` +
        `dealId: ${args.input.dealId ?? "n/a"}\n` +
        `borrower: ${args.input.borrowerName ?? "n/a"}\n\n` +
        `Narrative:\n${args.input.narrative}`,
      responseSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decision: {
            type: "string",
            enum: ["approve", "approve_with_conditions", "decline", "needs_more_info"],
          },
          summary: { type: "string" },
          key_risks: { type: "array", items: { type: "string" } },
          conditions: { type: "array", items: { type: "string" } },
          missing_info: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["decision", "summary", "confidence"],
      },
    });

    const latency = Date.now() - startTime;

    const parsed = JSON.parse(result.text);
    const validated = UnderwritingDecisionSchema.parse(parsed);

    // Log the run (Phase 1 minimal logging)
    console.log("[AI Orchestrator]", {
      model,
      task: args.task ?? "default",
      latency,
      userId: args.userId,
      success: true,
      decision: validated.decision,
    });

    return validated;
  } catch (error) {
    const latency = Date.now() - startTime;
    console.error("[AI Orchestrator] Error:", {
      model,
      task: args.task ?? "default",
      latency,
      userId: args.userId,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
