import "server-only";

import type { ClassicSpreadInput } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NarrativeSection = {
  title: string;
  body: string;
};

export type SpreadNarrative = {
  sections: NarrativeSection[];
  model: string;
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildNarrativePrompt(input: ClassicSpreadInput): string {
  const lines: string[] = [];
  lines.push(`Company: ${input.companyName}`);
  lines.push(`Periods: ${input.periods.map((p) => p.label).join(", ")}`);
  lines.push("");

  // Summarize key financials from the income statement rows
  lines.push("=== INCOME STATEMENT ===");
  for (const row of input.incomeStatement) {
    if (!row.label || row.values.every((v) => v == null)) continue;
    const vals = row.values.map((v) => (v != null ? v.toLocaleString("en-US") : "N/A"));
    lines.push(`${row.label}: ${vals.join(" | ")}`);
  }

  lines.push("");
  lines.push("=== BALANCE SHEET ===");
  for (const row of input.balanceSheet) {
    if (!row.label || row.values.every((v) => v == null)) continue;
    const vals = row.values.map((v) => (v != null ? v.toLocaleString("en-US") : "N/A"));
    lines.push(`${row.label}: ${vals.join(" | ")}`);
  }

  lines.push("");
  lines.push("=== CASH FLOW (UCA) ===");
  for (const row of input.cashFlow) {
    if (!row.label || row.values.every((v) => v == null)) continue;
    const vals = row.values.map((v) => (v != null ? v.toLocaleString("en-US") : "N/A"));
    lines.push(`${row.label}: ${vals.join(" | ")}`);
  }

  lines.push("");
  lines.push("=== RATIOS ===");
  for (const section of input.ratioSections) {
    lines.push(`-- ${section.title} --`);
    for (const row of section.rows) {
      const vals = row.values.map((v) => {
        if (v == null) return "N/A";
        if (typeof v === "string") return v;
        return v.toFixed(row.decimals);
      });
      lines.push(`${row.label}: ${vals.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

const SYSTEM_INSTRUCTION =
  "You are a senior credit analyst writing a narrative analysis section for a commercial bank " +
  "financial spread package. Write in professional third person. Be concise and specific — " +
  "cite exact dollar amounts and percentages. Structure your response as exactly 5 sections " +
  "with these headers (use ## markdown headers):\n\n" +
  "## Revenue & Profitability Analysis\n" +
  "## Balance Sheet & Liquidity Analysis\n" +
  "## Cash Flow Analysis\n" +
  "## Key Ratio Trends\n" +
  "## Risk Factors & Mitigants\n\n" +
  "Each section should be 2-4 sentences. Focus on year-over-year trends, " +
  "margin changes, leverage shifts, and coverage adequacy. " +
  "Flag any concerning trends. Do NOT use bullet points — use flowing prose.";

// ---------------------------------------------------------------------------
// API Call — Gemini 2.0 Flash
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-2.0-flash";

const GEMINI_API_URL = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

export async function generateSpreadNarrative(
  input: ClassicSpreadInput,
): Promise<SpreadNarrative | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[narrativeEngine] GEMINI_API_KEY not set — skipping narrative");
    return null;
  }

  // Skip if insufficient data
  if (input.incomeStatement.length === 0 && input.balanceSheet.length === 0) {
    return null;
  }

  const financialData = buildNarrativePrompt(input);

  try {
    const resp = await fetch(GEMINI_API_URL(apiKey), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: `${SYSTEM_INSTRUCTION}\n\nAnalyze the following financial spread data and write a narrative analysis:\n\n${financialData}`,
          }],
        }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.3 },
      }),
    });

    if (!resp.ok) {
      console.error(`[narrativeEngine] Gemini error ${resp.status}: ${await resp.text()}`);
      return null;
    }

    const json = await resp.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Parse sections from markdown headers
    const sections: NarrativeSection[] = [];
    const sectionRegex = /##\s+(.+?)(?:\n)([\s\S]*?)(?=##|\z|$)/g;
    let match;
    while ((match = sectionRegex.exec(text)) !== null) {
      const title = match[1]!.trim();
      const body = match[2]!.trim();
      if (body) {
        sections.push({ title, body });
      }
    }

    // If regex parsing fails, use the whole text as a single section
    if (sections.length === 0 && text.trim()) {
      sections.push({ title: "Financial Analysis", body: text.trim() });
    }

    return {
      sections,
      model: GEMINI_MODEL,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[narrativeEngine] Failed to generate narrative:", err);
    return null;
  }
}
