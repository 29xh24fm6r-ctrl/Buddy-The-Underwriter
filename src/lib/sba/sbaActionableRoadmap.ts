import "server-only";

// src/lib/sba/sbaActionableRoadmap.ts
// Phase 85-BPG-EXPERIENCE — "What this means for you" roadmap narrative.
// Single-purpose Gemini call that turns projection outputs into a plain-English
// set of milestones the borrower can actually use. Falls back to a deterministic
// summary if the model call fails or GEMINI_API_KEY is unavailable.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export interface RoadmapInput {
  businessName: string;
  loanAmount: number;
  revenue: number;
  breakEvenRevenue: number;
  marginOfSafetyPct: number;
  dscrYear1: number;
  dscrDownside: number;
  monthlyDebtService: number;
  grossMarginPct: number;
  cogsPercent: number;
  revenueGrowthY1: number;
}

export async function generateActionableRoadmap(
  input: RoadmapInput,
): Promise<string> {
  if (!GEMINI_API_KEY) return buildFallbackRoadmap(input);

  let model: string;
  try {
    const mod = await import("@/lib/ai/models");
    model = mod.MODEL_SBA_NARRATIVE;
  } catch {
    return buildFallbackRoadmap(input);
  }

  const monthlyRevTarget = Math.round(input.revenue / 12);
  const monthlyBreakEven = Math.round(input.breakEvenRevenue / 12);

  const prompt = `You are the world's leading business projections consultant. You've just completed a comprehensive financial projection for ${input.businessName}. Now deliver your expert guidance — what should the owner focus on to succeed?

PROJECTION DATA:
- Projected Year 1 revenue: $${input.revenue.toLocaleString()}
- Monthly revenue target: $${monthlyRevTarget.toLocaleString()}
- Monthly break-even: $${monthlyBreakEven.toLocaleString()} (${(input.marginOfSafetyPct * 100).toFixed(0)}% safety cushion)
- Loan amount: $${input.loanAmount.toLocaleString()}
- Monthly loan payment: $${Math.round(input.monthlyDebtService).toLocaleString()}
- Gross margin: ${(input.grossMarginPct * 100).toFixed(1)}%
- Cost of goods: ${(input.cogsPercent * 100).toFixed(0)}% of revenue
- Debt coverage: ${input.dscrYear1.toFixed(2)}x (${input.dscrYear1 >= 1.25 ? "above" : "below"} SBA minimum)
- Worst case coverage: ${input.dscrDownside.toFixed(2)}x
- Revenue growth assumption: ${(input.revenueGrowthY1 * 100).toFixed(0)}% Year 1

Write a 3-4 paragraph roadmap in second person ("you", "your"). Include:

1. WHAT THE NUMBERS MEAN: Translate the financials into plain English. "You need to generate $X per month to cover all costs including your loan payment. You're projecting $Y, which gives you $Z of cushion."

2. THREE KEY MILESTONES: Specific, measurable targets for Year 1. Example: "Hit $X monthly revenue by Month 3" or "Keep food cost below X%" — tied to their actual numbers.

3. RISK AWARENESS: One paragraph about what could go wrong and how to prepare. Use the downside scenario data. Be honest but not alarming.

4. THE BOTTOM LINE: One confident closing sentence about their business's financial health.

RULES:
- Use actual dollar amounts, not percentages where possible
- Sound like a trusted advisor, not a textbook
- No banking jargon (no "DSCR", no "debt service coverage ratio")
- No bullet points — flowing paragraphs
- Don't mention SBA, loans, or banking terms — this is about their BUSINESS
- Maximum 400 words

Return ONLY the roadmap text. No JSON. No markdown headers.`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );

    if (!resp.ok) return buildFallbackRoadmap(input);

    const json = (await resp.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string; thought?: boolean }>;
        };
      }>;
    };
    const text =
      json?.candidates?.[0]?.content?.parts
        ?.filter((p) => !p.thought)
        ?.map((p) => p.text ?? "")
        ?.join("") ?? "";

    const trimmed = text.trim();
    return trimmed || buildFallbackRoadmap(input);
  } catch {
    return buildFallbackRoadmap(input);
  }
}

function buildFallbackRoadmap(input: RoadmapInput): string {
  const monthlyRev = Math.round(input.revenue / 12);
  const monthlyBE = Math.round(input.breakEvenRevenue / 12);
  const cushion = monthlyRev - monthlyBE;
  const reserveGoal = Math.round(input.monthlyDebtService * 2);
  const earlyTarget = Math.round(monthlyRev * 0.8);
  const safetyPct = Math.round(input.marginOfSafetyPct * 100);
  const downsideOk = input.dscrDownside >= 1.25;

  return [
    `Your business is projected to generate $${monthlyRev.toLocaleString()} per month in Year 1. ` +
      `Your break-even point — the revenue you need just to cover all costs, including your monthly loan payment of $${Math.round(input.monthlyDebtService).toLocaleString()} — is $${monthlyBE.toLocaleString()} per month. ` +
      `That leaves you with $${cushion.toLocaleString()} of monthly cushion, a safety margin of about ${safetyPct}%.`,
    ``,
    `Focus on three targets for your first year. First, keep your cost of goods at or below ${(input.cogsPercent * 100).toFixed(0)}% of revenue — that's what holds your gross margin at ${(input.grossMarginPct * 100).toFixed(0)}%. ` +
      `Second, reach roughly $${earlyTarget.toLocaleString()} in monthly revenue by Month 3 so you're trending toward your annual goal. ` +
      `Third, build a cash reserve equal to at least two months of loan payments — around $${reserveGoal.toLocaleString()} — so you have runway if any one month is slow.`,
    ``,
    downsideOk
      ? `Even in a stress scenario where revenue drops 15%, your projections show you can still comfortably cover all your obligations. That's a strong foundation — but don't get complacent. Watch your monthly revenue closely in the first two quarters; that's when the surprises show up.`
      : `If revenue came in 15% below projection, cash flow would get tight. That doesn't mean disaster — it means you should build reserves early, keep a close eye on monthly revenue, and have a plan for trimming costs if you see two months in a row fall short.`,
    ``,
    `Your financial foundation is ${input.dscrYear1 >= 1.5 ? "strong" : input.dscrYear1 >= 1.25 ? "solid" : "under pressure but workable with discipline"} — stick to the numbers in this plan and you'll have the visibility you need to run the business with confidence.`,
  ].join("\n");
}
