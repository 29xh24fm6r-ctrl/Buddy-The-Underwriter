import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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
  return task === "deep_reasoning" ? "o1-preview" : "gpt-4o-mini";
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
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are Buddy The Underwriter. Be concise, evidence-first, and practical. " +
            "Return only valid JSON matching the schema.",
        },
        {
          role: "user",
          content:
            `Deal context:\n` +
            `dealId: ${args.input.dealId ?? "n/a"}\n` +
            `borrower: ${args.input.borrowerName ?? "n/a"}\n\n` +
            `Narrative:\n${args.input.narrative}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "underwriting_decision",
          strict: true,
          schema: {
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
        },
      },
    });

    const latency = Date.now() - startTime;

    // Extract JSON from response
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content in response");
    }

    const parsed = JSON.parse(content);
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
