/**
 * Borrower Concierge API - Conversational SBA Intake (WOW Factor #1)
 * 
 * POST /api/borrower/concierge
 * 
 * Magic:
 * - Borrower answers in plain English
 * - Buddy translates to SBA-required structure
 * - Shows progress bar + next 3 easiest tasks
 * - Cites SOP + bank policy for every answer
 * 
 * Principle: "Ask the MINIMUM next question that changes the decision"
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getOpenAI } from "@/lib/ai/openaiClient";
import { retrieveEvidence } from "@/lib/retrieval/retrievalCore";
import { evaluateAllRules, getMissingFacts, getNextCriticalFact } from "@/lib/policy/ruleEngine";

interface ConciergeRequest {
  dealId: string;
  program: "7a" | "504";
  userMessage: string;
  sessionId?: string;
}

interface ConciergeResponse {
  ok: boolean;
  sessionId: string;
  buddyResponse: string;
  extractedFacts: Record<string, any>;
  missingFacts: string[];
  nextCriticalFact: { fact: string; question: string } | null;
  progressPct: number;
  documentRequests: Array<{ doc: string; reason: string }>;
  citations: Array<{ label: string; page?: number; snippet: string }>;
}

export async function POST(req: NextRequest): Promise<NextResponse<ConciergeResponse>> {
  try {
    const bankId = await getCurrentBankId();
    const body = (await req.json()) as ConciergeRequest;
    const { dealId, program, userMessage, sessionId } = body;

    const sb = supabaseAdmin();
    const openai = getOpenAI();

    // 1) Load or create session
    let session: any;
    if (sessionId) {
      const { data } = await sb
        .from("borrower_concierge_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();
      session = data;
    }

    if (!session) {
      const { data: newSession } = await sb
        .from("borrower_concierge_sessions")
        .insert({
          deal_id: dealId,
          program,
          conversation_history: [],
          extracted_facts: {},
          missing_facts: [],
        })
        .select("*")
        .single();
      session = newSession;
    }

    // 2) Retrieve relevant SBA guidance + bank policy
    const evidence = await retrieveEvidence({
      dealId,
      bankId,
      program,
      queryText: userMessage,
      topK: 10,
      includeRerank: true,
    });

    const contextText = evidence.citations
      .slice(0, 5)
      .map((c, i) => `[${i + 1}] ${c.label}: ${c.quote}`)
      .join("\n\n");

    // 3) Extract facts from conversation using AI
    const extractPrompt = `You are Buddy, an SBA loan concierge. Extract structured facts from this conversation.

CONVERSATION HISTORY:
${JSON.stringify(session.conversation_history || [], null, 2)}

USER MESSAGE:
${userMessage}

EVIDENCE (SOP + BANK POLICY):
${contextText}

Extract facts in this JSON structure:
{
  "business": {
    "is_for_profit": true/false/null,
    "naics": "string or null",
    "annual_revenue": number or null,
    "employees": number or null,
    "years_in_business": number or null
  },
  "financials": {
    "dscr": number or null,
    "loan_amount": number or null,
    "use_of_proceeds": "string or null"
  },
  "owners": [
    { "name": "string", "ownership_pct": number }
  ]
}

Return ONLY the extracted facts JSON. Use null for unknown values.`;

    const extractResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: extractPrompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const extractedFacts = JSON.parse(extractResponse.choices[0].message.content || "{}");

    // Merge with previous facts
    const allFacts = {
      ...session.extracted_facts,
      ...extractedFacts,
      business: { ...session.extracted_facts?.business, ...extractedFacts.business },
      financials: { ...session.extracted_facts?.financials, ...extractedFacts.financials },
    };

    // 4) Evaluate SBA rules to find missing facts
    const ruleResults = await evaluateAllRules(program, allFacts);
    const missingFacts = getMissingFacts(ruleResults);
    const nextCriticalFact = getNextCriticalFact(ruleResults);

    // 5) Calculate progress (% of required facts collected)
    const totalRequired = 20; // Estimate total SBA facts needed
    const collected = Object.keys(allFacts).length;
    const progressPct = Math.min(100, Math.round((collected / totalRequired) * 100));

    // 6) Generate Buddy's response with citations
    const responsePrompt = `You are Buddy, an SBA loan concierge. Respond to the borrower in a friendly, clear way.

BORROWER SAID:
${userMessage}

EXTRACTED FACTS:
${JSON.stringify(extractedFacts, null, 2)}

MISSING FACTS:
${missingFacts.join(", ")}

NEXT CRITICAL FACT (ask this next):
${nextCriticalFact ? `${nextCriticalFact.fact} (unlocks ${nextCriticalFact.impact} rules)` : "none"}

EVIDENCE:
${contextText}

Generate response with:
1. Acknowledge what they said
2. If next critical fact exists, ask ONE simple question to get it
3. Cite sources using [1], [2] format
4. Keep it conversational and encouraging

Return JSON:
{
  "message": "your response text with [1] citations",
  "next_question": "simple question to ask" or null,
  "document_requests": [{"doc": "name", "reason": "why needed"}]
}`;

    const responseCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: responsePrompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const buddyOutput = JSON.parse(responseCompletion.choices[0].message.content || "{}");

    // 7) Update session
    const updatedHistory = [
      ...(session.conversation_history || []),
      { role: "user", content: userMessage },
      { role: "assistant", content: buddyOutput.message },
    ];

    await sb
      .from("borrower_concierge_sessions")
      .update({
        conversation_history: updatedHistory,
        extracted_facts: allFacts,
        missing_facts: missingFacts,
        progress_pct: progressPct,
        last_question: buddyOutput.next_question,
        last_response: userMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    // 8) Log to ai_events
    await sb.from("ai_events").insert({
      deal_id: dealId,
      scope: "borrower_concierge",
      action: "chat",
      input_json: { userMessage, extractedFacts },
      output_json: { buddyResponse: buddyOutput.message, progressPct },
      evidence_json: evidence.evidence_json,
      confidence: 0.9,
      requires_human_review: false,
    });

    return NextResponse.json({
      ok: true,
      sessionId: session.id,
      buddyResponse: buddyOutput.message,
      extractedFacts: allFacts,
      missingFacts,
      nextCriticalFact: nextCriticalFact
        ? {
            fact: nextCriticalFact.fact,
            question: buddyOutput.next_question || `What is ${nextCriticalFact.fact}?`,
          }
        : null,
      progressPct,
      documentRequests: buddyOutput.document_requests || [],
      citations: evidence.citations.slice(0, 5).map((c) => ({
        label: c.label,
        page: c.page,
        snippet: c.quote,
      })),
    });
  } catch (error) {
    console.error("Concierge error:", error);
    return NextResponse.json(
      { ok: false, error: String(error) } as any,
      { status: 500 }
    );
  }
}
