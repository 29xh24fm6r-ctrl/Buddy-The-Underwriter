/**
 * Committee Simulation Engine - UPGRADED FOR GOD MODE
 * 
 * Multi-persona panel with citation-grade evaluations:
 * 1. SBA Officer - SOP compliance, eligibility checks
 * 2. Credit Officer - Financial covenants, DSCR, collateral
 * 3. Closing Specialist - Documents, guarantees, UCC filings
 * 4. Relationship Manager - Borrower experience, risk communication
 * 
 * Each persona uses retrievalCore for triple-source evidence:
 * - Deal documents
 * - SBA SOP guidance
 * - Bank policies
 */

import { z } from "zod";
import { getOpenAI } from "@/lib/ai/openaiClient";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { retrieveEvidence, type Citation } from "@/lib/retrieval/retrievalCore";
import { evaluateAllRules, getMissingFacts, getNextCriticalFact } from "@/lib/policy/ruleEngine";
import { OPENAI_CHAT } from "@/lib/ai/models";

export type CommitteeStance = "APPROVE" | "APPROVE_WITH_CONDITIONS" | "DECLINE";

export type PersonaKey = "credit" | "sba_compliance" | "risk" | "relationship_manager";

export type PersonaEvaluation = {
  persona: PersonaKey;
  display_name: string;
  stance: CommitteeStance;
  concerns: string[];
  required_fixes: string[];
  citations: Array<{ i: number; reason: string }>;
};

export type CommitteeResult = {
  event_id: string;
  evaluations: PersonaEvaluation[];
  consensus: {
    overall_stance: CommitteeStance;
    total_concerns: number;
    critical_fixes: string[];
  };
};

const PersonaResponseSchema = z.object({
  stance: z.enum(["APPROVE", "APPROVE_WITH_CONDITIONS", "DECLINE"]),
  concerns: z.array(z.string().trim().min(1).max(1_000)).max(20),
  required_fixes: z.array(z.string().trim().min(1).max(1_000)).max(20),
  citations: z
    .array(
      z.object({
        i: z.number().int().min(1),
        reason: z.string().trim().min(1).max(1_000),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * Run full committee evaluation
 */
export async function runCommittee({
  dealId,
  bankId,
  question,
  personas = ["credit", "sba_compliance", "risk", "relationship_manager"] as PersonaKey[],
}: {
  dealId: string;
  bankId?: string;
  question: string;
  personas?: PersonaKey[];
}): Promise<CommitteeResult> {
  const sb = supabaseAdmin();
  const openai = getOpenAI();

  // 1. Retrieve unified context (deal + bank + SBA)
  const evidence = await retrieveEvidence({
    dealId,
    bankId: bankId || "",
    queryText: question,
    topK: 20,
  });

  const citations = evidence.citations.filter(
    (citation: Citation) =>
      typeof citation.quote === "string" && citation.quote.trim().length > 0,
  );
  if (citations.length === 0) {
    throw new Error("committee_evidence_required");
  }
  const formattedContext = citations
    .map((citation: Citation) => citation.quote.trim())
    .join("\n\n");

  // 2. Fetch every requested persona configuration and fail closed if the
  // configuration query is incomplete.
  const requestedPersonas = Array.from(new Set(personas));
  const { data: personaConfigs, error: personaConfigError } = await sb
    .from("committee_personas")
    .select("*")
    .in("persona_key", requestedPersonas);

  if (personaConfigError) {
    console.error("[runCommittee] persona query failed", {
      code: personaConfigError.code,
    });
    throw new Error("committee_persona_load_failed");
  }
  if (
    !personaConfigs ||
    personaConfigs.length !== requestedPersonas.length
  ) {
    throw new Error("committee_persona_configuration_incomplete");
  }

  // 3. Run each persona evaluation in parallel
  const evaluations = await Promise.all(
    personaConfigs.map(async (config) => {
      const evaluation = await evaluateAsPersona({
        persona: config.persona_key as PersonaKey,
        displayName: config.display_name,
        systemPrompt: config.system_prompt,
        evaluationTemplate: config.evaluation_template,
        question,
        context: formattedContext,
        citationCount: citations.length,
        openai,
      });

      return evaluation;
    })
  );

  // 4. Calculate consensus
  const consensus = calculateConsensus(evaluations);

  // 5. Store AI event
  const { data: aiEvent, error: aiEventError } = await sb
    .from("ai_events")
    .insert({
      deal_id: dealId,
      scope: "committee_simulation",
      action: "evaluate",
      input_json: {
        question,
        personas,
        context_chunks: citations.length,
      },
      output_json: {
        evaluations,
        consensus,
      },
      model: OPENAI_CHAT,
      requires_human_review: true,
    })
    .select("id")
    .single();

  if (aiEventError || !aiEvent?.id) {
    console.error("[runCommittee] AI event persistence failed", {
      code: aiEventError?.code,
    });
    throw new Error("committee_event_persist_failed");
  }
  const eventId = aiEvent.id;

  // 6. Store citations before acknowledging the evaluation.
  const { error: citationError } = await sb
    .from("ai_event_citations")
    .insert(
      citations.map((citation) => ({
        event_id: eventId,
        ...citation,
      })),
    );
  if (citationError) {
    console.error("[runCommittee] citation persistence failed", {
      eventId,
      code: citationError.code,
    });
    throw new Error("committee_citations_persist_failed");
  }

  return {
    event_id: eventId,
    evaluations,
    consensus,
  };
}

/**
 * Evaluate deal as specific persona
 */
async function evaluateAsPersona({
  persona,
  displayName,
  systemPrompt,
  evaluationTemplate,
  question,
  context,
  citationCount,
  openai,
}: {
  persona: PersonaKey;
  displayName: string;
  systemPrompt: string;
  evaluationTemplate: string;
  question: string;
  context: string;
  citationCount: number;
  openai: ReturnType<typeof getOpenAI>;
}): Promise<PersonaEvaluation> {
  const userPrompt = `${evaluationTemplate}

QUESTION: ${question}

DEAL CONTEXT:
${context}

Respond in JSON format:
{
  "stance": "APPROVE" | "APPROVE_WITH_CONDITIONS" | "DECLINE",
  "concerns": ["concern 1", "concern 2", ...],
  "required_fixes": ["fix 1", "fix 2", ...],
  "citations": [{"i": 1, "reason": "why this citation matters"}, ...]
}`;

  const completion = await openai.chat.completions.create({
    model: OPENAI_CHAT,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const result = PersonaResponseSchema.parse(
    JSON.parse(completion.choices[0].message.content || "{}"),
  );
  if (result.citations.some((citation) => citation.i > citationCount)) {
    throw new Error("committee_evaluation_citation_invalid");
  }

  return {
    persona,
    display_name: displayName,
    stance: result.stance,
    concerns: result.concerns,
    required_fixes: result.required_fixes,
    citations: result.citations,
  };
}

/**
 * Calculate consensus from all persona evaluations
 */
function calculateConsensus(evaluations: PersonaEvaluation[]): {
  overall_stance: CommitteeStance;
  total_concerns: number;
  critical_fixes: string[];
} {
  // Count stances
  const stanceCounts = {
    APPROVE: 0,
    APPROVE_WITH_CONDITIONS: 0,
    DECLINE: 0,
  };

  evaluations.forEach((e) => {
    stanceCounts[e.stance]++;
  });

  // Determine overall stance (most conservative wins)
  let overall_stance: CommitteeStance = "APPROVE";
  if (stanceCounts.DECLINE > 0) {
    overall_stance = "DECLINE";
  } else if (stanceCounts.APPROVE_WITH_CONDITIONS > 0) {
    overall_stance = "APPROVE_WITH_CONDITIONS";
  }

  // Aggregate concerns
  const total_concerns = evaluations.reduce((sum, e) => sum + e.concerns.length, 0);

  // Extract critical fixes (mentioned by multiple personas)
  const fixCounts = new Map<string, number>();
  evaluations.forEach((e) => {
    e.required_fixes.forEach((fix) => {
      fixCounts.set(fix, (fixCounts.get(fix) || 0) + 1);
    });
  });

  const critical_fixes = Array.from(fixCounts.entries())
    .filter(([_, count]) => count >= 2) // Mentioned by 2+ personas
    .map(([fix, _]) => fix);

  return {
    overall_stance,
    total_concerns,
    critical_fixes,
  };
}

/**
 * Get committee summary for display
 */
export function formatCommitteeSummary(result: CommitteeResult): string {
  const { consensus, evaluations } = result;

  let summary = `**Overall Recommendation:** ${consensus.overall_stance}\n\n`;

  if (consensus.critical_fixes.length > 0) {
    summary += `**Critical Fixes Required:**\n`;
    consensus.critical_fixes.forEach((fix) => {
      summary += `- ${fix}\n`;
    });
    summary += `\n`;
  }

  summary += `**Persona Evaluations:**\n\n`;
  evaluations.forEach((e) => {
    summary += `**${e.display_name}:** ${e.stance}\n`;
    if (e.concerns.length > 0) {
      summary += `Concerns: ${e.concerns.join(", ")}\n`;
    }
    summary += `\n`;
  });

  return summary;
}
