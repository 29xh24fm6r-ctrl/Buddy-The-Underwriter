/**
 * Committee Simulation Engine
 * 
 * Runs multi-persona evaluation of deals:
 * - Credit Officer
 * - SBA Compliance Officer
 * - Risk Officer
 * - Relationship Manager
 * 
 * Each persona evaluates with different rubric and risk tolerance.
 */

import { getOpenAI } from "@/lib/ai/openaiClient";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { retrieveContext, formatRetrievalContext, extractCitations } from "@/lib/retrieval/unified";

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
  run_id: string;
  evaluations: PersonaEvaluation[];
  consensus: {
    overall_stance: CommitteeStance;
    total_concerns: number;
    critical_fixes: string[];
  };
};

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
  const context = await retrieveContext({
    dealId,
    bankId,
    query: question,
    sources: ["DEAL_DOC", "BANK_POLICY", "SBA_POLICY"],
    topK: 20,
  });

  const formattedContext = formatRetrievalContext(context);
  const citations = extractCitations(context);

  // 2. Fetch persona configurations
  const { data: personaConfigs } = await sb
    .from("committee_personas")
    .select("*")
    .in("persona_key", personas);

  if (!personaConfigs || personaConfigs.length === 0) {
    throw new Error("No committee personas found");
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
        openai,
      });

      return evaluation;
    })
  );

  // 4. Calculate consensus
  const consensus = calculateConsensus(evaluations);

  // 5. Store AI run event
  const { data: runEvent } = await sb
    .from("ai_run_events")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      run_kind: "COMMITTEE",
      input_json: {
        question,
        personas,
        context_chunks: context.length,
      },
      output_json: {
        evaluations,
        consensus,
      },
      model: "gpt-4o",
    })
    .select("run_id")
    .single();

  const runId = runEvent?.run_id ?? "unknown";

  // 6. Store citations
  if (citations.length > 0) {
    await sb.from("ai_run_citations").insert(
      citations.map((c) => ({
        run_id: runId,
        ...c,
      }))
    );
  }

  return {
    run_id: runId,
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
  openai,
}: {
  persona: PersonaKey;
  displayName: string;
  systemPrompt: string;
  evaluationTemplate: string;
  question: string;
  context: string;
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
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const result = JSON.parse(completion.choices[0].message.content || "{}");

  return {
    persona,
    display_name: displayName,
    stance: result.stance ?? "DECLINE",
    concerns: result.concerns ?? [],
    required_fixes: result.required_fixes ?? [],
    citations: result.citations ?? [],
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
