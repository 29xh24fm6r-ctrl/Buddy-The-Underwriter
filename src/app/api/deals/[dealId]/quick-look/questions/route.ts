import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { computeGatekeeperDocReadiness } from "@/lib/gatekeeper/readinessServer";
import { GEMINI_FLASH } from "@/lib/ai/models";

export const runtime = "nodejs";
export const maxDuration = 30;
type Params = Promise<{ dealId: string }>;

const GEMINI_MODEL = GEMINI_FLASH;

function geminiUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

export type QuickLookQuestion = {
  category: "financial_clarity" | "data_gaps" | "risk_factors";
  question: string;
  context: string;
  priority: "high" | "medium";
};

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: 403 });

  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("name, deal_mode, borrower_id")
    .eq("id", dealId)
    .maybeSingle();
  if (deal?.deal_mode !== "quick_look") {
    return NextResponse.json(
      { ok: false, error: "only available for quick_look deals" },
      { status: 400 },
    );
  }

  const { data: borrower } = await sb
    .from("borrowers")
    .select("legal_name")
    .eq("id", deal.borrower_id)
    .maybeSingle();
  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end, confidence")
    .eq("deal_id", dealId)
    .eq("is_superseded", false)
    .not("fact_value_num", "is", null)
    .order("fact_period_end", { ascending: false })
    .limit(60);

  const readiness = await computeGatekeeperDocReadiness(dealId);
  const missingDocs = [
    ...readiness.missing.businessTaxYears.map((y: number) => `Business Tax Return ${y}`),
    ...readiness.missing.personalTaxYears.map((y: number) => `Personal Tax Return ${y}`),
    readiness.missing.financialStatementsMissing ? "YTD Financial Statement" : null,
    readiness.missing.pfsMissing ? "Personal Financial Statement" : null,
  ].filter(Boolean) as string[];

  const factsByPeriod = new Map<string, string[]>();
  for (const f of facts ?? []) {
    const p = f.fact_period_end ?? "unknown";
    if (!factsByPeriod.has(p)) factsByPeriod.set(p, []);
    factsByPeriod.get(p)!.push(
      `  ${f.fact_key}: ${Number(f.fact_value_num).toLocaleString("en-US", { maximumFractionDigits: 0 })} (conf: ${Math.round(Number(f.confidence ?? 0) * 100)}%)`,
    );
  }
  const factsSummary = Array.from(factsByPeriod.entries())
    .slice(0, 3)
    .map(([p, lines]) => `Period ${p}:\n${lines.slice(0, 10).join("\n")}`)
    .join("\n\n");

  const prompt = `You are a senior commercial banking credit officer preparing for a borrower meeting.
Preliminary (Quick Look) analysis of ${borrower?.legal_name ?? "the borrower"} — incomplete package.

FINANCIAL DATA:\n${factsSummary || "No facts extracted yet."}

MISSING DOCUMENTS:\n${missingDocs.length > 0 ? missingDocs.join(", ") : "None"}

Generate 9-12 targeted questions. Categories:
FINANCIAL_CLARITY (3-4): Reference actual numbers. Ask about anomalies and trends.
DATA_GAPS (2-3): Ask about each missing document specifically — why missing, when available.
RISK_FACTORS (3-4): Key person risk, debt not in package, contingent liabilities, guarantor capacity.

Rules: specific not generic. Financial questions must use actual dollar amounts when available. Write as if speaking directly in the meeting.

Respond ONLY with valid JSON array. Schema:
[{"category":"financial_clarity"|"data_gaps"|"risk_factors","question":"...","context":"...","priority":"high"|"medium"}]`;

  // Generation is non-blocking — failure returns ok:true with empty questions
  let questions: QuickLookQuestion[] = [];
  let generationStatus: "success" | "failed" | "empty" = "empty";
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");

    const resp = await fetch(geminiUrl(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 2000,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`gemini_quick_look_${resp.status}: ${errText.slice(0, 300)}`);
    }

    const json = await resp.json();
    const raw: string =
      json?.candidates?.[0]?.content?.parts
        ?.filter((p: { thought?: boolean }) => !p.thought)
        ?.map((p: { text?: string }) => p.text ?? "")
        ?.join("") ?? "";

    const cleaned = raw.replace(/```json|```/g, "").trim();
    if (cleaned.startsWith("[")) {
      questions = JSON.parse(cleaned);
      generationStatus = questions.length > 0 ? "success" : "empty";
    }
  } catch (e) {
    console.error("[quick-look/questions] non-fatal generation failure:", e);
    generationStatus = "failed";
  }

  return NextResponse.json({
    ok: true,
    borrowerName: borrower?.legal_name ?? "",
    dealMode: "quick_look",
    readinessPct: readiness.readinessPct,
    missingDocs,
    questions,
    generationStatus,
    generatedAt: new Date().toISOString(),
  });
}
