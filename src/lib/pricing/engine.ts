// src/lib/pricing/engine.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordAiEvent } from "@/lib/ai/audit";
import { aiJson } from "@/lib/ai/openai";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function quotePricing(args: {
  dealId: string;
  requestedAmount: number;
  termMonths: number;
  riskRating: number; // 1(best) - 10(worst) for example
  collateralStrength: "strong" | "moderate" | "weak";
}) {
  // Deterministic baseline grid (v1)
  const baseSpreadByRisk = (rr: number) => {
    // Example spreads, adjust to your bank policy
    const rrClamped = clamp(rr, 1, 10);
    return 1.75 + (rrClamped - 1) * 0.35; // 1.75% .. 4.90%
  };

  let spread = baseSpreadByRisk(args.riskRating);

  if (args.collateralStrength === "strong") spread -= 0.25;
  if (args.collateralStrength === "weak") spread += 0.35;

  spread = clamp(spread, 1.25, 7.50);

  const outputs = {
    pricing_basis: "Prime + spread",
    spread_pct: Number(spread.toFixed(2)),
    term_months: args.termMonths,
    fees: {
      origination_pct: 0.50,
    },
  };

  // AI rationale (never changes numbers; only explains)
  const schemaHint = `{
    "rationale": [
      {"point":"string","evidence":"string"}
    ],
    "adjustment_ideas": [
      {"idea":"string","risk":"string","when_to_use":"string"}
    ]
  }`;

  const ai = await aiJson<any>({
    scope: "pricing",
    action: "rationale",
    system:
      "You are a senior credit officer. Explain pricing deterministically given the inputs and outputs. Do not change numbers. Provide concise rationale and adjustment ideas.",
    user: `INPUTS:\n${JSON.stringify(args, null, 2)}\nOUTPUTS:\n${JSON.stringify(outputs, null, 2)}\nReturn JSON matching schema.`,
    jsonSchemaHint: schemaHint,
  });

  await recordAiEvent({
    deal_id: args.dealId,
    scope: "pricing",
    action: "quote",
    input_json: args,
    output_json: { outputs, ai: ai.ok ? ai.result : { error: ai.error } },
    confidence: ai.ok ? ai.confidence : null,
    evidence_json: null,
    requires_human_review: true,
  });

  const sb = supabaseAdmin();
  const ins = await sb.from("pricing_quotes").insert({
    deal_id: args.dealId,
    inputs_json: args,
    outputs_json: outputs,
    rationale_json: ai.ok ? ai.result : { rationale: [{ point: "AI rationale unavailable", evidence: "AI stub or error" }] },
  }).select("*").single();
  if (ins.error) throw ins.error;

  return { outputs, rationale: ai.ok ? ai.result : null, quoteRow: ins.data };
}
