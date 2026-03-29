import "server-only";

import type { SensitivityScenario, ManagementMember } from "./sbaReadinessTypes";

const GEMINI_MODEL = "gemini-2.0-flash";

const GEMINI_API_URL = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

function safeParseField(text: string, field: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed[field] === "string" ? parsed[field] : fallback;
  } catch {
    return text.length > 50 ? text : fallback;
  }
}

async function callGeminiJSON(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[sbaPackageNarrative] GEMINI_API_KEY not set");
    return "";
  }

  const resp = await fetch(GEMINI_API_URL(apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`gemini_sba_narrative_${resp.status}: ${errText.slice(0, 300)}`);
  }

  const json = await resp.json();
  const text: string =
    json?.candidates?.[0]?.content?.parts
      ?.filter((p: { thought?: boolean }) => !p.thought)
      ?.map((p: { text?: string }) => p.text ?? "")
      ?.join("") ?? "";

  return text;
}

/** Call 1: Section 1 — Business Overview */
export async function generateBusinessOverviewNarrative(params: {
  dealName: string;
  loanType: string;
  loanAmount: number;
  managementTeam: ManagementMember[];
  revenueStreamNames: string[];
  useOfProceedsDescription: string;
  researchSummary?: string;
}): Promise<string> {
  const prompt = `You are writing a business plan narrative for an SBA ${params.loanType.replace("_", " ").toUpperCase()} loan application.
Tone: professional, factual, optimistic but grounded. Write in third person.
RULES: Do NOT invent market statistics. Do NOT use superlatives. Do NOT mention loan approval, denial, creditworthiness, or risk grade.
Every claim must be directly supportable from the inputs provided.

Borrower: ${params.dealName}
Loan amount: $${params.loanAmount.toLocaleString()}
Management team: ${JSON.stringify(params.managementTeam)}
Revenue streams: ${params.revenueStreamNames.join(", ")}
Use of proceeds: ${params.useOfProceedsDescription}
Market research context: ${params.researchSummary ?? "Not available"}

Return ONLY valid JSON with this exact shape and no other text:
{
  "companyDescription": "2 paragraphs: what the business does, how long it has operated, key markets served",
  "productsAndServices": "1 paragraph: what products or services are offered",
  "marketOpportunity": "1 paragraph: market context from research only — no invented statistics",
  "managementTeam": "1–2 sentences per team member: name, title, years in industry, relevant background",
  "useOfProceeds": "1 paragraph: how loan proceeds will be deployed and expected business impact",
  "fullNarrative": "all five sections joined with section headers: Company Description, Products & Services, Market Opportunity, Management Team, Use of Proceeds"
}`;

  try {
    const text = await callGeminiJSON(prompt);
    return safeParseField(text, "fullNarrative", "Business overview not available.");
  } catch (err) {
    console.error("[sbaPackageNarrative] generateBusinessOverviewNarrative error:", err);
    return "Business overview not available.";
  }
}

/** Call 2: Section 5 — Sensitivity Commentary */
export async function generateSensitivityNarrative(params: {
  scenarios: SensitivityScenario[];
  breakEvenMarginOfSafetyPct: number;
  year1MinCumulativeCash: number;
  loanType: string;
}): Promise<string> {
  const base = params.scenarios.find((s) => s.name === "base");
  const downside = params.scenarios.find((s) => s.name === "downside");

  const prompt = `You are a commercial banker summarizing a sensitivity analysis for an SBA ${params.loanType.replace("_", " ").toUpperCase()} credit package.
RULES: Do NOT mention loan approval, denial, creditworthy, or risk grade. State facts. Use plain language.
The SBA minimum DSCR is 1.25x. Flag any scenario year below this threshold.

Base DSCR Y1/Y2/Y3: ${base?.dscrYear1.toFixed(2) ?? "N/A"}/${base?.dscrYear2.toFixed(2) ?? "N/A"}/${base?.dscrYear3.toFixed(2) ?? "N/A"}
Downside DSCR Y1/Y2/Y3: ${downside?.dscrYear1.toFixed(2) ?? "N/A"}/${downside?.dscrYear2.toFixed(2) ?? "N/A"}/${downside?.dscrYear3.toFixed(2) ?? "N/A"}
Break-even margin of safety: ${(params.breakEvenMarginOfSafetyPct * 100).toFixed(1)}%
Year 1 minimum cumulative cash: $${Math.round(params.year1MinCumulativeCash).toLocaleString()}

Return ONLY valid JSON:
{
  "narrative": "2–3 paragraphs: (1) base case summary, (2) downside risk assessment with specific numbers, (3) recommended actions if downside materializes"
}`;

  try {
    const text = await callGeminiJSON(prompt);
    return safeParseField(text, "narrative", "Sensitivity analysis not available.");
  } catch (err) {
    console.error("[sbaPackageNarrative] generateSensitivityNarrative error:", err);
    return "Sensitivity analysis not available.";
  }
}
