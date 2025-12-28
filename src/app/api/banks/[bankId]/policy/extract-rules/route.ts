/**
 * POST /api/banks/{bankId}/policy/extract-rules
 * 
 * AI-assisted extraction of credit committee rules from uploaded
 * credit policy documents.
 * 
 * REQUEST:
 * {
 *   "uploadId": "uuid",
 *   "policyText": "full text of credit policy"
 * }
 * 
 * RESPONSE:
 * {
 *   "ok": true,
 *   "extraction_id": "uuid",
 *   "rules": { loan_amount_gt: 500000, ... },
 *   "confidence": "high" | "medium" | "low",
 *   "explanation": "..."
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { aiJson } from "@/lib/ai/openai";

type Ctx = { params: Promise<{ bankId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { bankId: routeBankId } = await ctx.params;
  const currentBankId = await getCurrentBankId();

  // Tenant check
  if (routeBankId !== currentBankId) {
    return NextResponse.json(
      { ok: false, error: "Bank ID mismatch" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { uploadId, policyText } = body;

  if (!uploadId || !policyText) {
    return NextResponse.json(
      { ok: false, error: "Missing uploadId or policyText" },
      { status: 400 }
    );
  }

  // AI extraction
  const extracted = await aiJson({
    scope: "governance",
    action: "extract-committee-policy-rules",
    system: `You are a credit policy analyst. Extract enforceable credit committee rules from policy documents.

Rules should be deterministic thresholds that trigger committee approval requirements.

VALID RULE TYPES:
- loan_amount_gt: number (dollars)
- dscr_lt: number (decimal, e.g., 1.15)
- ltv_gt: number (decimal, e.g., 0.85)
- risk_rating_gte: number (1-10 scale)
- collateral_shortfall_gt: number (dollars)
- exceptions_present: boolean (true if policy exceptions trigger committee)

Return JSON with:
{
  "rules": { ... },
  "confidence": "high" | "medium" | "low",
  "explanation": "Brief summary of what you extracted and why"
}`,
    user: `Extract credit committee governance rules from the following credit policy text.

POLICY TEXT:
${policyText.slice(0, 10000)}

Return ONLY JSON with rules, confidence, and explanation.`,
    jsonSchemaHint: JSON.stringify({
      type: "object",
      properties: {
        rules: {
          type: "object",
          properties: {
            loan_amount_gt: { type: "number" },
            dscr_lt: { type: "number" },
            ltv_gt: { type: "number" },
            risk_rating_gte: { type: "number" },
            collateral_shortfall_gt: { type: "number" },
            exceptions_present: { type: "boolean" }
          }
        },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        explanation: { type: "string" }
      },
      required: ["rules", "confidence", "explanation"]
    })
  });

  if (!extracted.ok) {
    return NextResponse.json(
      { ok: false, error: extracted.error },
      { status: 500 }
    );
  }

  const sb = supabaseAdmin();

  // Store extracted rules (not yet approved)
  const { data: insertion, error: insertError } = await sb
    .from("policy_extracted_rules")
    .insert({
      bank_id: currentBankId,
      source_upload_id: uploadId,
      extracted_rules_json: extracted.result.rules || {},
      extraction_confidence: extracted.result.confidence || "low",
      extraction_explanation: extracted.result.explanation || "No explanation provided",
      approved: false
    })
    .select()
    .single();

  if (insertError) {
    console.error("Failed to save extracted rules:", insertError);
    return NextResponse.json(
      { ok: false, error: "Failed to save extracted rules" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    extraction_id: insertion.id,
    rules: extracted.result.rules || {},
    confidence: extracted.result.confidence || "low",
    explanation: extracted.result.explanation || ""
  });
}
