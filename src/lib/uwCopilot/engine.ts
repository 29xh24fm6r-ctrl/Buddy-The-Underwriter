// src/lib/uwCopilot/engine.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/openai";
import { recordAiEvent } from "@/lib/ai/audit";

export async function draftUwPackage(dealId: string) {
  const sb = supabaseAdmin();

  // Pull discovery facts
  const facts = await sb.from("credit_discovery_facts").select("*").eq("deal_id", dealId).limit(1000);
  if (facts.error) throw facts.error;

  // Pull ownership
  const owners = await sb.from("ownership_entities").select("*").eq("deal_id", dealId);
  if (owners.error) throw owners.error;

  const edges = await sb.from("ownership_edges").select("*").eq("deal_id", dealId);
  if (edges.error) throw edges.error;

  // Pull doc intel summaries
  const docs = await sb.from("doc_intel_results").select("*").eq("deal_id", dealId).limit(200);
  if (docs.error) throw docs.error;

  const schemaHint = `{
    "credit_memo_draft": {
      "executive_summary":"string",
      "borrower_overview":"string",
      "business_model":"string",
      "ownership_and_management":"string",
      "loan_request":"string",
      "repayment_sources":"string",
      "risks_and_mitigants":[{"risk":"string","mitigant":"string"}],
      "required_underwriting_items":[{"item":"string","why":"string"}]
    }
  }`;

  const ai = await aiJson<any>({
    scope: "uw_copilot",
    action: "draft_credit_memo",
    system:
      "You are a senior commercial credit officer. Draft a concise, banker-grade credit memo from structured facts. Do not invent numbers. Use 'Unknown' where missing.",
    user:
      `DISCOVERY_FACTS:\n${JSON.stringify(facts.data || [], null, 2)}\n\nOWNERSHIP:\n${JSON.stringify({ owners: owners.data, edges: edges.data }, null, 2)}\n\nDOC_INTEL:\n${JSON.stringify(docs.data || [], null, 2)}\n\nReturn JSON exactly matching schema.`,
    jsonSchemaHint: schemaHint,
  });

  await recordAiEvent({
    deal_id: dealId,
    scope: "uw_copilot",
    action: "draft_credit_memo",
    input_json: { dealId },
    output_json: ai.ok ? ai.result : { error: ai.error },
    confidence: ai.ok ? ai.confidence : null,
    evidence_json: { facts: (facts.data || []).length, owners: (owners.data || []).length, docs: (docs.data || []).length },
    requires_human_review: true,
  });

  if (!ai.ok) throw new Error(ai.error);

  return ai.result;
}
