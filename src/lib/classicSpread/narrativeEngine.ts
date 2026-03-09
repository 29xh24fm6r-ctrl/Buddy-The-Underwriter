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
// API Call
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5-20250929";

export async function generateSpreadNarrative(
  input: ClassicSpreadInput,
): Promise<SpreadNarrative | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[narrativeEngine] ANTHROPIC_API_KEY not set — skipping narrative");
    return null;
  }

  // Skip if insufficient data
  if (input.incomeStatement.length === 0 && input.balanceSheet.length === 0) {
    return null;
  }

  const financialData = buildNarrativePrompt(input);

  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_INSTRUCTION,
        messages: [
          {
            role: "user",
            content: `Analyze the following financial spread data and write a narrative analysis:\n\n${financialData}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      console.error(`[narrativeEngine] API error ${resp.status}: ${await resp.text()}`);
      return null;
    }

    const json = await resp.json() as {
      content: Array<{ type: string; text: string }>;
      model: string;
    };
    const text = json.content.find((c) => c.type === "text")?.text ?? "";

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
      model: json.model ?? MODEL,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[narrativeEngine] Failed to generate narrative:", err);
    return null;
  }
}
