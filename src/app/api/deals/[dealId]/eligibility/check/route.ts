/**
 * Instant SBA Eligibility Check API (WOW Factor #2)
 * 
 * POST /api/deals/:dealId/eligibility/check
 * 
 * Magic:
 * - PASS/FAIL/UNKNOWN with confidence score
 * - Shows which rules passed/failed/unknown
 * - Triple-source citations (SOP + bank policy + deal docs)
 * - Auto-generates "what to fix" checklist
 * 
 * Returns results in <2 seconds for instant dopamine.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchDealContext } from "@/lib/deals/fetchDealContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { evaluateAllRules, getMissingFacts, getNextCriticalFact } from "@/lib/policy/ruleEngine";
import { retrieveEvidence } from "@/lib/retrieval/retrievalCore";

interface EligibilityCheckRequest {
  program: "7a" | "504";
  dealFacts?: Record<string, any>;
}

interface EligibilityCheckResponse {
  ok: boolean;
  overall: "PASS" | "FAIL" | "UNKNOWN";
  confidence: number;
  rules: {
    passed: string[];
    failed: string[];
    unknown: string[];
  };
  missingFacts: string[];
  nextCriticalFact: { fact: string; impact: number } | null;
  requiredActions: string[];
  citations: Array<{ label: string; page?: number; snippet: string }>;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
): Promise<NextResponse<EligibilityCheckResponse>> {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const body = (await req.json()) as EligibilityCheckRequest;
    const { program, dealFacts = {} } = body;

    const sb = supabaseAdmin();

    // 1) Load deal data if no facts provided
    let facts = dealFacts;
    if (Object.keys(facts).length === 0) {
      const context = await fetchDealContext(dealId);
      if (!context.ok) {
        return NextResponse.json(
          { 
            ok: false, 
            overall: "UNKNOWN" as const,
            confidence: 0,
            rules: {
              passed: [],
              failed: [],
              unknown: []
            },
            missingFacts: ["deal_context"],
            nextCriticalFact: null,
            requiredActions: [context.error || "Deal not found"],
            citations: []
          } satisfies EligibilityCheckResponse,
          { status: 404 }
        );
      }
      
      // Note: Full deal record would need to be fetched separately if we need all fields
      // For now, we can only extract what's in context. Consider adding more fields to /context
      // or creating a dedicated /deals/:id/full endpoint if needed.
      facts = {
        business: {
          is_for_profit: true, // Assume for-profit unless stated
        },
        // Additional fields would come from a more complete deal fetch
      };
    }

    // 2) Evaluate all SBA rules
    const ruleResults = await evaluateAllRules(program, facts);

    // 3) Categorize results
    const passed = Object.entries(ruleResults)
      .filter(([_, r]) => r.result === "PASS")
      .map(([k]) => k);
    const failed = Object.entries(ruleResults)
      .filter(([_, r]) => r.result === "FAIL")
      .map(([k]) => k);
    const unknown = Object.entries(ruleResults)
      .filter(([_, r]) => r.result === "UNKNOWN")
      .map(([k]) => k);

    // 4) Determine overall result
    let overall: "PASS" | "FAIL" | "UNKNOWN" = "PASS";
    let confidence = 1.0;

    if (failed.length > 0) {
      overall = "FAIL";
      confidence = 0.95;
    } else if (unknown.length > 0) {
      overall = "UNKNOWN";
      confidence = 0.5;
    }

    // 5) Find missing facts + next critical question
    const missingFacts = getMissingFacts(ruleResults);
    const nextCriticalFact = getNextCriticalFact(ruleResults);

    // 6) Retrieve citations for failed rules
    const failedRuleKeys = failed.join(" ");
    const evidence = failedRuleKeys
      ? await retrieveEvidence({
          dealId,
          bankId,
          program,
          queryText: `SBA eligibility rules: ${failedRuleKeys}`,
          topK: 5,
          includeRerank: false,
        })
      : { citations: [] };

    // 7) Generate required actions
    const requiredActions: string[] = [];
    for (const key of failed) {
      const result = ruleResults[key];
      requiredActions.push(`Fix ${key}: ${result.explanation}`);
    }
    for (const fact of missingFacts.slice(0, 3)) {
      requiredActions.push(`Provide missing information: ${fact}`);
    }

    // 8) Log to ai_events
    await sb.from("ai_events").insert({
      deal_id: dealId,
      scope: "eligibility_check",
      action: "evaluate",
      input_json: { program, facts },
      output_json: { overall, passed, failed, unknown },
      evidence_json: { retrieval: evidence.citations },
      confidence,
      requires_human_review: overall !== "PASS",
    });

    // 9) Store check result
    for (const [ruleKey, result] of Object.entries(ruleResults)) {
      await sb.from("deal_eligibility_checks").insert({
        deal_id: dealId,
        program,
        rule_key: ruleKey,
        result: result.result,
        explanation: result.explanation,
        missing_facts: result.missing_facts,
        citations: evidence.citations.slice(0, 3),
      });
    }

    return NextResponse.json({
      ok: true,
      overall,
      confidence,
      rules: { passed, failed, unknown },
      missingFacts,
      nextCriticalFact,
      requiredActions: requiredActions.slice(0, 5),
      citations: evidence.citations.slice(0, 5).map((c) => ({
        label: c.label,
        page: c.page,
        snippet: c.quote,
      })),
    });
  } catch (error) {
    console.error("Eligibility check error:", error);
    return NextResponse.json({ ok: false, error: String(error) } as any, { status: 500 });
  }
}
