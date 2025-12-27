/**
 * Multi-Persona Committee System (God Mode)
 * 
 * Each persona brings domain expertise + retrieval-augmented insights:
 * - SBA Officer: SOP compliance, eligibility rules, program fit
 * - Credit Officer: Financial strength, DSCR, debt coverage
 * - Closing Specialist: Documentation completeness, legal requirements
 * - Relationship Manager: Borrower-friendly explanations, next steps
 */

import { getOpenAI } from "@/lib/ai/openaiClient";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { retrieveEvidence, type Citation } from "@/lib/retrieval/retrievalCore";
import { evaluateAllRules, getMissingFacts } from "@/lib/policy/ruleEngine";

// ============================================================================
// Types
// ============================================================================

export type PersonaKey = "sba_officer" | "credit_officer" | "closing_specialist" | "relationship_manager";

export interface PersonaEvaluation {
  persona: PersonaKey;
  display_name: string;
  stance: "APPROVE" | "APPROVE_WITH_CONDITIONS" | "DECLINE";
  verdict: string;
  concerns: string[];
  required_actions: string[];
  citations: Citation[];
}

export interface CommitteeResult {
  event_id: string;
  evaluations: PersonaEvaluation[];
  consensus: {
    overall_stance: "APPROVE" | "APPROVE_WITH_CONDITIONS" | "DECLINE";
    critical_actions: string[];
    confidence: number;
  };
  next_steps: string[];
}

// ============================================================================
// Persona Definitions
// ============================================================================

const PERSONAS: Record<PersonaKey, { name: string; role: string; focus: string }> = {
  sba_officer: {
    name: "SBA Officer",
    role: "SBA compliance and eligibility specialist",
    focus: "Verify SOP compliance, check eligibility rules, ensure program fit",
  },
  credit_officer: {
    name: "Credit Officer",
    role: "Financial analysis and credit risk expert",
    focus: "Analyze DSCR, debt coverage, collateral adequacy, repayment ability",
  },
  closing_specialist: {
    name: "Closing Specialist",
    role: "Documentation and legal requirements expert",
    focus: "Ensure all required documents present, UCC filings complete, guarantees executed",
  },
  relationship_manager: {
    name: "Relationship Manager",
    role: "Borrower experience and communication specialist",
    focus: "Translate compliance into borrower-friendly language, outline next steps clearly",
  },
};

// ============================================================================
// Core: Evaluate as Persona
// ============================================================================

async function evaluateAsPersona(params: {
  persona: PersonaKey;
  dealId: string;
  bankId: string;
  program: "7a" | "504";
  question: string;
  citations: Citation[];
  evidence: any;
  ruleResults?: Record<string, any>;
}): Promise<PersonaEvaluation> {
  const { persona, dealId, bankId, program, question, citations, evidence, ruleResults } = params;
  const personaDef = PERSONAS[persona];
  const openai = getOpenAI();

  // Build context from citations
  const contextText = citations
    .map(
      (c, i) =>
        `[${i + 1}] ${c.label} (${c.page ? `p${c.page}` : `pp${c.page_start}-${c.page_end}`}): ${c.quote}`
    )
    .join("\n\n");

  // Add rule evaluation results for SBA Officer
  let ruleContext = "";
  if (persona === "sba_officer" && ruleResults) {
    const passed = Object.entries(ruleResults).filter(([_, r]: any) => r.result === "PASS");
    const failed = Object.entries(ruleResults).filter(([_, r]: any) => r.result === "FAIL");
    const unknown = Object.entries(ruleResults).filter(([_, r]: any) => r.result === "UNKNOWN");

    ruleContext = `\n\nSBA ELIGIBILITY RULES EVALUATION:
✅ Passed: ${passed.map(([k]) => k).join(", ") || "none"}
❌ Failed: ${failed.map(([k]) => k).join(", ") || "none"}
❓ Unknown: ${unknown.map(([k]) => k).join(", ") || "none"}`;
  }

  const systemPrompt = `You are the ${personaDef.name}, a ${personaDef.role}.

Your focus: ${personaDef.focus}

You MUST cite sources using [1], [2], [3] references to the evidence below.

EVIDENCE:
${contextText}${ruleContext}

Return a JSON object with:
{
  "stance": "APPROVE" | "APPROVE_WITH_CONDITIONS" | "DECLINE",
  "verdict": "2-3 sentence summary of your recommendation",
  "concerns": ["list", "of", "concerns"],
  "required_actions": ["specific", "next", "steps"],
  "citation_indices": [1, 3, 5] // which evidence items you cited
}`;

  const userPrompt = `Evaluate this SBA ${program} deal:

Question: ${question}

Provide your ${personaDef.name} evaluation.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(response.choices[0].message.content || "{}");

  return {
    persona,
    display_name: personaDef.name,
    stance: result.stance || "APPROVE_WITH_CONDITIONS",
    verdict: result.verdict || "",
    concerns: result.concerns || [],
    required_actions: result.required_actions || [],
    citations: (result.citation_indices || []).map((i: number) => citations[i - 1]).filter(Boolean),
  };
}

// ============================================================================
// Main: Run Committee
// ============================================================================

export async function runCommittee(params: {
  dealId: string;
  bankId: string;
  program: "7a" | "504";
  question: string;
  personas?: PersonaKey[];
  dealFacts?: Record<string, any>;
}): Promise<CommitteeResult> {
  const {
    dealId,
    bankId,
    program,
    question,
    personas = ["sba_officer", "credit_officer", "closing_specialist", "relationship_manager"],
    dealFacts = {},
  } = params;

  const sb = supabaseAdmin();

  // 1) Retrieve evidence from all 3 stores
  const evidence = await retrieveEvidence({
    dealId,
    bankId,
    program,
    queryText: question,
    topK: 15,
    includeRerank: true,
  });

  // 2) Evaluate SBA rules (for SBA Officer)
  const ruleResults = await evaluateAllRules(program, dealFacts);

  // 3) Run each persona evaluation in parallel
  const evaluations = await Promise.all(
    personas.map((persona) =>
      evaluateAsPersona({
        persona,
        dealId,
        bankId,
        program,
        question,
        citations: evidence.citations,
        evidence: evidence.evidence_json,
        ruleResults: persona === "sba_officer" ? ruleResults : undefined,
      })
    )
  );

  // 4) Determine consensus
  const approveCount = evaluations.filter((e) => e.stance === "APPROVE").length;
  const declineCount = evaluations.filter((e) => e.stance === "DECLINE").length;

  let overall_stance: "APPROVE" | "APPROVE_WITH_CONDITIONS" | "DECLINE" = "APPROVE_WITH_CONDITIONS";
  if (declineCount >= 2) overall_stance = "DECLINE";
  else if (approveCount === personas.length) overall_stance = "APPROVE";

  const allActions = evaluations.flatMap((e) => e.required_actions);
  const uniqueActions = Array.from(new Set(allActions));

  // 5) Log to ai_events
  const { data: eventRow } = await sb
    .from("ai_events")
    .insert({
      deal_id: dealId,
      scope: "committee_simulation",
      action: "evaluate",
      input_json: { question, program, personas },
      output_json: { evaluations, consensus: { overall_stance } },
      evidence_json: evidence.evidence_json,
      confidence: overall_stance === "APPROVE" ? 0.9 : overall_stance === "DECLINE" ? 0.8 : 0.7,
      requires_human_review: overall_stance !== "APPROVE",
    })
    .select("id")
    .single();

  // 6) Store citations
  if (eventRow) {
    const citationRows = evidence.citations.map((c, i) => ({
      citation_id: crypto.randomUUID(),
      event_id: eventRow.id,
      source_kind: c.source_kind,
      chunk_id: c.chunk_id,
      page_num: c.page,
      quote: c.quote,
      similarity: c.similarity,
      citation_index: i,
    }));

    await sb.from("ai_event_citations").insert(citationRows);
  }

  // 7) Generate next steps
  const missingFacts = getMissingFacts(ruleResults);
  const next_steps = [
    ...uniqueActions.slice(0, 3),
    ...(missingFacts.length > 0 ? [`Gather missing info: ${missingFacts.join(", ")}`] : []),
  ];

  return {
    event_id: eventRow?.id || "",
    evaluations,
    consensus: {
      overall_stance,
      critical_actions: uniqueActions.slice(0, 5),
      confidence: overall_stance === "APPROVE" ? 0.9 : 0.7,
    },
    next_steps,
  };
}
