import "server-only";

import type { ClassicSpreadInput } from "./types";
import { spreadAuditGuardrailLines, withAuditCaveat, clampBlockerConclusions } from "./narrativeGuardrail";
import { runRole } from "@/lib/ai/gateway";

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

  // SPEC-CLASSIC-SPREAD-LINE-ACCURACY-COMPLETION-AUDIT-1: feed the accuracy/completion audit into
  // the prompt as a hard guardrail — the model must NOT draw strong conclusions about rows/periods
  // that failed reconciliation.
  lines.push(...spreadAuditGuardrailLines(input.certificationAudit?.spreadAccuracy ?? null));

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
// API Call — AI gateway (generator role — Gemini default)
// ---------------------------------------------------------------------------
//
// SPEC-M1.1: migrated onto the gateway. Temperature 0.3 is still requested
// unconditionally — providers/google.ts's own gemini-3.x branch already
// ignores a temperature override for gemini-3.x models (uses thinkingConfig
// instead), so this reproduces the original isGemini3Model conditional
// without duplicating that logic here.

export async function generateSpreadNarrative(
  input: ClassicSpreadInput,
): Promise<SpreadNarrative | null> {
  // Skip if insufficient data
  if (input.incomeStatement.length === 0 && input.balanceSheet.length === 0) {
    return null;
  }

  const financialData = buildNarrativePrompt(input);

  try {
    const result = await runRole("generator", {
      purpose: "classic_spread_narrative",
      maxOutputTokens: 1500,
      temperature: 0.3,
      prompt: `${SYSTEM_INSTRUCTION}\n\nAnalyze the following financial spread data and write a narrative analysis:\n\n${financialData}`,
    });

    const text = result.text;

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

    // SPEC-CLASSIC-SPREAD-LINE-ACCURACY-COMPLETION-AUDIT-1: when the spread audit found blocker-level
    // exceptions, lead the narrative with a deterministic data-reliability caveat regardless of what
    // the model produced — strong conclusions must not stand unqualified on unreconciled rows.
    // #3: under a BLOCKER, clamp strong-positive conclusions in the model sections, THEN lead with
    // the deterministic Data Reliability Caveat.
    const audit = input.certificationAudit?.spreadAccuracy ?? null;
    const finalSections = withAuditCaveat(clampBlockerConclusions(sections, audit), audit);

    return {
      sections: finalSections,
      model: result.model,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[narrativeEngine] Failed to generate narrative:", err);
    return null;
  }
}
