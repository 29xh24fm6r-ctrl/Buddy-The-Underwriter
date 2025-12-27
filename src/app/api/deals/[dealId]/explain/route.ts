import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { aiJson } from "@/lib/ai/openai";

/**
 * GET /api/deals/[dealId]/explain?topic=<topic>
 * 
 * Returns a plain-English explanation of why something is required.
 * Uses AI to generate borrower-friendly explanations based on SBA rules and deal context.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    const bankId = await getCurrentBankId();
    const topic = req.nextUrl.searchParams.get("topic");

    if (!topic) {
      return Response.json({ ok: false, error: "Missing topic parameter" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Verify deal access
    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, business_name")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (dealError || !deal) {
      return Response.json({ ok: false, error: "Deal not found" }, { status: 404 });
    }

    // Fetch relevant context from arbitration decisions
    const { data: decisions } = await sb
      .from("arbitration_decisions")
      .select("*")
      .eq("deal_id", dealId)
      .ilike("topic", `%${topic}%`)
      .limit(5);

    // Fetch relevant SBA policy findings
    const { data: findings } = await sb
      .from("agent_findings")
      .select("*")
      .eq("deal_id", dealId)
      .eq("agent_name", "sba-policy")
      .limit(5);

    // Generate explanation using AI
    const explanation = await generateExplanation(topic, {
      dealName: deal.business_name,
      decisions: decisions || [],
      findings: findings || [],
    });

    return Response.json({
      ok: true,
      explanation,
    });
  } catch (err) {
    console.error("Explain API error:", err);
    return Response.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Generate plain-English explanation using AI
 */
async function generateExplanation(
  topic: string,
  context: {
    dealName: string;
    decisions: any[];
    findings: any[];
  }
) {
  const prompt = `You are a friendly SBA loan advisor explaining requirements to a borrower.

Topic: "${topic}"
Business: ${context.dealName}

Context from underwriting:
${JSON.stringify(context.decisions.slice(0, 3), null, 2)}

Relevant SBA rules:
${JSON.stringify(context.findings.slice(0, 3), null, 2)}

Generate a borrower-friendly explanation with:
1. plain_english: A clear, jargon-free explanation (2-3 sentences)
2. key_factors: 2-3 bullet points explaining what we're evaluating
3. what_you_can_do: 1-2 concrete action items the borrower can take
4. sba_rule_citation: The official SBA rule (if applicable, otherwise null)

Rules:
- Use "you" and "we" (friendly, conversational)
- No jargon (explain "DSCR" as "cash flow coverage")
- Be encouraging, not scary
- Keep it short and actionable

Return JSON only.`;

  const result = await aiJson<{
    plain_english: string;
    key_factors: string[];
    what_you_can_do: string[];
    sba_rule_citation: string | null;
  }>({
    scope: "deals.explain",
    action: "generate_explanation",
    system: [
      "You are a friendly SBA loan advisor explaining requirements to a borrower.",
      "Keep it short and actionable.",
      "Return JSON only.",
    ].join("\n"),
    user: prompt,
    jsonSchemaHint: [
      "Return JSON with fields:",
      "- plain_english: string",
      "- key_factors: string[]",
      "- what_you_can_do: string[]",
      "- sba_rule_citation: string | null",
    ].join("\n"),
  });

  if (!result.ok) {
    return {
      plain_english: "We're reviewing this requirement based on SBA guidelines. Our team will reach out if we need more information.",
      key_factors: [],
      what_you_can_do: ["Check back later for updates"],
      sba_rule_citation: null,
    };
  }

  return result.result;
}
