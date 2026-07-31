import { z } from "zod";
import { runRole } from "./gateway";

// ---------------------------------------------------------------------------
// Gateway helper
// ---------------------------------------------------------------------------
//
// SPEC-M1.1 — migrated onto the AI gateway (generator role). A permissive
// object responseSchema is passed (rather than the full MemoJsonSchema
// zod schema hand-translated to JSON Schema) to preserve the existing
// "ask for JSON via prompt, zod-validate, repair-retry on failure" contract
// exactly — this function's whole job is producing raw text for the
// caller's own generate+repair loop, not enforcing a schema itself.

async function geminiGenerate(system: string, userContent: string): Promise<string> {
  const result = await runRole("generator", {
    purpose: "credit_memo",
    // Audit fix (Borrower Intake Program review): userContent embeds
    // context.borrower/context.financials/etc — real borrower PII — this
    // was never tagged, so the gateway's NPI-refusal gate silently never
    // fired regardless of vendor-approval status. Tagging it correctly
    // means this call now throws while all vendors remain PENDING
    // (docs/vendors/*.md) — generateAdvancedCreditMemo's caller below
    // treats that identically to any other generator failure, degrading
    // to the existing hard-fallback stub memo rather than propagating,
    // since this function has no fallback of its own.
    npiTagged: true,
    temperature: 0.2,
    maxOutputTokens: 8192,
    responseSchema: { type: "object" },
    prompt: `${system}\n\n${userContent}`,
  });
  return result.text;
}

/** safeJsonParse's shape, but for a call that may throw before returning text at all. */
async function tryGeminiGenerate(system: string, userContent: string): Promise<{ ok: true; text: string } | { ok: false }> {
  try {
    return { ok: true, text: await geminiGenerate(system, userContent) };
  } catch (err) {
    console.error("[creditMemoGenerator] generator call failed:", err instanceof Error ? err.message : String(err));
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

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
  const r1 = await tryGeminiGenerate(system.trim(), JSON.stringify(userPayload));
  let generatorCallFailed = !r1.ok;
  if (r1.ok) {
    const p1 = safeJsonParse(r1.text);
    if (p1.ok) {
      const v = MemoJsonSchema.safeParse(p1.value);
      if (v.success) return postProcess(v.data);
    }
  }

  // Attempt 2 (repair) — skipped entirely if attempt 1 didn't even produce
  // text to repair (a thrown generator call, not a schema-validation miss).
  if (r1.ok) {
    const r2 = await tryGeminiGenerate(
      system.trim(),
      `Fix into valid JSON matching schema. Output JSON only:\n${r1.text}`,
    );
    generatorCallFailed = generatorCallFailed || !r2.ok;
    if (r2.ok) {
      const p2 = safeJsonParse(r2.text);
      if (p2.ok) {
        const v = MemoJsonSchema.safeParse(p2.value);
        if (v.success) return postProcess(v.data);
      }
    }
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
    warnings: [
      generatorCallFailed
        ? "Generator call failed (see server logs) — falling back to a placeholder memo."
        : "Generator failed schema validation twice.",
    ],
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
