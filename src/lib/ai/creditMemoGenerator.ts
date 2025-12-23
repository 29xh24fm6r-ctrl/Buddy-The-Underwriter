import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MemoJsonSchema = z.object({
  meta: z.object({
    dealId: z.string(),
    memoVersion: z.string().default("v1"),
    generatedAt: z.string(),
    recommendedDecision: z.string(),
    confidence: z.number().min(0).max(1).default(0.7),
  }),
  cockpit: z.object({
    keyMetrics: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
    riskRadar: z
      .array(z.object({ category: z.string(), score: z.number().min(1).max(5), note: z.string() }))
      .default([]),
    missingItems: z.array(z.object({ item: z.string(), why: z.string() })).default([]),
  }),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      bullets: z.array(z.string()).optional(),
      body: z.string().optional(),
      tables: z.array(
        z.object({
          title: z.string().optional(),
          columns: z.array(z.string()),
          rows: z.array(z.array(z.union([z.string(), z.number()]))),
        })
      ).optional(),
    })
  ),
  evidence: z.array(z.object({ label: z.string(), source: z.string(), note: z.string().optional(), confidence: z.number().optional() })).default([]),
  warnings: z.array(z.string()).default([]),
});

export type MemoJson = z.infer<typeof MemoJsonSchema>;

function safeJsonParse(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false as const, error: e };
  }
}

export async function generateAdvancedCreditMemo(params: {
  dealId: string;
  userOverrides?: string; // optional extra instruction
  context: Record<string, any>; // deal fields + doc extracts (eventually real)
}): Promise<{
  memoJson: MemoJson;
  warnings: string[];
  missingDocRequests: Array<{ docType: string; note: string }>;
}> {
  const { dealId, userOverrides, context } = params;

  const system = `
You are Buddy The Underwriter — the most powerful AI underwriting system.
Generate an "Advanced Credit Memo" as STRICT JSON only (no markdown).
Your output MUST match this schema:
- meta
- cockpit (keyMetrics, riskRadar, missingItems)
- sections[] (must include all major underwriting sections)
- evidence[]
- warnings[]

Context fields (source of truth):
- Use context.borrower, context.facilities, context.collateral, context.spread, context.financials, context.documents, context.extracts as primary data sources
- When you include a key metric, include at least one matching EvidenceRef in evidence[]
- Reference context.evidenceIndex for available evidence anchors
- Key Metrics must be populated from context.extracts[].fields when available (Revenue, EBITDA, NetIncome) and from context.spread when available (DSCR/LTV). If not available, add to missingItems.

Underwriting requirements:
- Be decisive: recommendedDecision must be one of: "APPROVE", "APPROVE WITH CONDITIONS", "DECLINE", "PENDING - MISSING INFO".
- If any critical inputs are missing, use "PENDING - MISSING INFO" and add missingItems + warnings.
- Never fabricate documents. If something is unknown, explicitly mark as assumption in warnings and add missingItems.
- Include sensitivity thinking: DSCR downside, rate shock, revenue drop, etc. If numbers missing, provide framework + request inputs.
- Keep it committee-ready: crisp, quantified, mitigants tied to conditions.

Sections required (use these titles in order):
1) General & Applicant Information
2) Financing Request
3) Deal Summary / Purpose
4) Sources & Uses
5) Collateral Analysis
6) Eligibility
7) Business & Industry Analysis
8) Site / Location Analysis
9) Management Qualifications
10) Financial Analysis
11) Strengths & Weaknesses
12) Conditions / Exceptions / Monitoring
13) Recommendation & Approval Rationale
`;

  const userPayload = {
    dealId,
    overrides: userOverrides ?? "",
    context,
    now: new Date().toISOString(),
  };

  // Attempt 1
  const r1 = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system.trim() },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });

  const t1 = r1.choices?.[0]?.message?.content?.trim() ?? "";
  const p1 = safeJsonParse(t1);
  if (p1.ok) {
    const v = MemoJsonSchema.safeParse(p1.value);
    if (v.success) return postProcess(v.data);
  }

  // Attempt 2 (repair)
  const r2 = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system.trim() },
      { role: "user", content: `Fix into valid JSON matching schema. Output JSON only:\n${t1}` },
    ],
  });

  const t2 = r2.choices?.[0]?.message?.content?.trim() ?? "";
  const p2 = safeJsonParse(t2);
  if (p2.ok) {
    const v = MemoJsonSchema.safeParse(p2.value);
    if (v.success) return postProcess(v.data);
  }

  // hard fallback
  const fallback: MemoJson = {
    meta: {
      dealId,
      memoVersion: "v1",
      generatedAt: new Date().toISOString(),
      recommendedDecision: "PENDING - MISSING INFO",
      confidence: 0.3,
    },
    cockpit: {
      keyMetrics: {},
      riskRadar: [],
      missingItems: [{ item: "Deal dataset", why: "No usable deal context provided to generator." }],
    },
    sections: [
      { id: "general", title: "General & Applicant Information", body: "Missing deal context." },
      { id: "finreq", title: "Financing Request", body: "Missing loan structure." },
      { id: "summary", title: "Deal Summary / Purpose", body: "Missing purpose." },
      { id: "sources", title: "Sources & Uses", body: "Missing sources/uses." },
      { id: "collateral", title: "Collateral Analysis", body: "Missing collateral." },
      { id: "elig", title: "Eligibility", body: "Missing eligibility details." },
      { id: "industry", title: "Business & Industry Analysis", body: "Missing operating details." },
      { id: "site", title: "Site / Location Analysis", body: "Missing location/lease." },
      { id: "mgmt", title: "Management Qualifications", body: "Missing sponsor bio." },
      { id: "fin", title: "Financial Analysis", body: "Missing financial statements." },
      { id: "sw", title: "Strengths & Weaknesses", body: "Insufficient data." },
      { id: "cond", title: "Conditions / Exceptions / Monitoring", body: "Insufficient data." },
      { id: "rec", title: "Recommendation & Approval Rationale", body: "Cannot conclude without inputs." },
    ],
    evidence: [],
    warnings: ["Generator failed schema validation twice."],
  };

  return postProcess(fallback);

  function postProcess(memoJson: MemoJson) {
    // ensure required meta fields
    memoJson.meta.dealId = dealId;
    memoJson.meta.generatedAt = memoJson.meta.generatedAt || new Date().toISOString();
    memoJson.meta.memoVersion = memoJson.meta.memoVersion || "v1";

    // Extract missing doc requests from missingItems heuristically
    const missingDocRequests = (memoJson.cockpit?.missingItems ?? [])
      .slice(0, 10)
      .map((m) => ({
        docType: m.item,
        note: m.why,
      }));

    return {
      memoJson,
      warnings: memoJson.warnings ?? [],
      missingDocRequests,
    };
  }
}
