/**
 * Auto-Document Request List API (WOW Factor #3)
 * 
 * POST /api/deals/:dealId/documents/auto-request
 * 
 * Magic:
 * - AI generates checklist based on SBA program + deal type
 * - Shows WHY each doc matters (cites SOP)
 * - Provides upload link for each item
 * - Prioritizes by "unlock value" (which docs unblock most rules)
 * 
 * Output: Borrower-friendly checklist they can complete in order.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getOpenAI } from "@/lib/ai/openaiClient";
import { retrieveEvidence } from "@/lib/retrieval/retrievalCore";
import { evaluateAllRules, getMissingFacts } from "@/lib/policy/ruleEngine";

interface DocumentRequest {
  doc_name: string;
  why_needed: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  upload_link: string;
  sop_citation: string;
}

interface AutoRequestResponse {
  ok: boolean;
  requests: DocumentRequest[];
  total_docs: number;
  estimated_time_mins: number;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
): Promise<NextResponse<AutoRequestResponse>> {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const body = await req.json();
    const { program = "7a", dealFacts = {} } = body;

    const sb = supabaseAdmin();
    const openai = getOpenAI();

    // 1) Evaluate rules to find missing facts
    const ruleResults = await evaluateAllRules(program, dealFacts);
    const missingFacts = getMissingFacts(ruleResults);

    // 2) Retrieve SBA SOP guidance on required documents
    const evidence = await retrieveEvidence({
      dealId,
      bankId,
      program,
      queryText: `SBA ${program} required documents checklist application package`,
      topK: 10,
      includeRerank: true,
    });

    const contextText = evidence.citations
      .map((c, i) => `[${i + 1}] ${c.label} (p${c.page}): ${c.quote}`)
      .join("\n\n");

    // 3) Generate document request list using AI
    const prompt = `You are Buddy, an SBA loan assistant. Generate a document request list for this SBA ${program} loan.

MISSING FACTS NEEDED:
${missingFacts.join(", ")}

SBA SOP GUIDANCE:
${contextText}

Generate a prioritized document checklist. For each document:
1. What document is needed
2. WHY it's needed (borrower-friendly explanation)
3. Priority level (HIGH/MEDIUM/LOW)
4. Cite SOP reference [1], [2], etc.

Return JSON array:
[
  {
    "doc_name": "Business Tax Returns (3 consecutive years)",
    "why_needed": "SBA requires 3 consecutive years of returns to verify business income stability",
    "priority": "HIGH",
    "sop_citation": "[1]"
  }
]

Focus on the 8-12 most important documents. Order by priority.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    const docList = result.documents || [];

    // 4) Add upload links
    const requests: DocumentRequest[] = docList.map((doc: any) => ({
      doc_name: doc.doc_name,
      why_needed: doc.why_needed,
      priority: doc.priority || "MEDIUM",
      upload_link: `/deals/${dealId}/upload?doc=${encodeURIComponent(doc.doc_name)}`,
      sop_citation: doc.sop_citation || "",
    }));

    // 5) Estimate time (2 mins per doc)
    const estimatedTime = requests.length * 2;

    // 6) Log to ai_events
    await sb.from("ai_events").insert({
      deal_id: dealId,
      scope: "document_requests",
      action: "generate",
      input_json: { program, missingFacts },
      output_json: { requests },
      evidence_json: evidence.evidence_json,
      confidence: 0.85,
      requires_human_review: false,
    });

    return NextResponse.json({
      ok: true,
      requests,
      total_docs: requests.length,
      estimated_time_mins: estimatedTime,
    });
  } catch (error) {
    console.error("Auto-request error:", error);
    return NextResponse.json({ ok: false, error: String(error) } as any, { status: 500 });
  }
}
