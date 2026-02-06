import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtractedLineItem = {
  factKey: string;
  value: number;
  confidence: number;
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;   // YYYY-MM-DD
  provenance: FinancialFactProvenance;
};

export type ExtractionResult = {
  ok: boolean;
  factsWritten: number;
  error?: string;
};

// ---------------------------------------------------------------------------
// Claude AI call
// ---------------------------------------------------------------------------

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const MAX_OCR_CHARS = 25_000;

export async function callClaudeForExtraction(args: {
  systemPrompt: string;
  ocrText: string;
  maxTokens?: number;
}): Promise<Record<string, unknown>> {
  const anthropic = new Anthropic();

  const truncated =
    args.ocrText.length > MAX_OCR_CHARS
      ? args.ocrText.slice(0, MAX_OCR_CHARS) + "\n\n[... truncated ...]"
      : args.ocrText;

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: args.maxTokens ?? 4096,
    messages: [
      {
        role: "user",
        content: `${args.systemPrompt}\n\nDocument content:\n---\n${truncated}\n---\n\nRespond with JSON only.`,
      },
    ],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in Claude response");
  }

  return JSON.parse(jsonMatch[0]);
}

// ---------------------------------------------------------------------------
// Period normalization
// ---------------------------------------------------------------------------

/**
 * Parse various period strings into { start, end } ISO date strings.
 * Handles: "2024-01", "Jan 2024", "FY2023", "Q3 2024", "2023-01-01 to 2023-12-31", "2023"
 */
export function normalizePeriod(raw: string | null | undefined): {
  start: string | null;
  end: string | null;
} {
  if (!raw) return { start: null, end: null };
  const s = String(raw).trim();

  // Already ISO date range: "2023-01-01 to 2023-12-31"
  const rangeMatch = s.match(/^(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})$/i);
  if (rangeMatch) {
    return { start: rangeMatch[1], end: rangeMatch[2] };
  }

  // Full ISO date: "2024-01-01"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { start: s, end: s };
  }

  // YYYY-MM format: "2024-01"
  const ymMatch = s.match(/^(\d{4})-(\d{2})$/);
  if (ymMatch) {
    const y = Number(ymMatch[1]);
    const m = Number(ymMatch[2]);
    const start = `${y}-${pad2(m)}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
    return { start, end };
  }

  // "Jan 2024", "January 2024"
  const monthNameMatch = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{4})$/i);
  if (monthNameMatch) {
    const m = monthNameToNum(monthNameMatch[1]);
    const y = Number(monthNameMatch[2]);
    if (m && y) {
      const start = `${y}-${pad2(m)}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
      return { start, end };
    }
  }

  // "Q1 2024", "Q3 2023"
  const qMatch = s.match(/^Q(\d)\s+(\d{4})$/i);
  if (qMatch) {
    const q = Number(qMatch[1]);
    const y = Number(qMatch[2]);
    if (q >= 1 && q <= 4) {
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      const start = `${y}-${pad2(startMonth)}-01`;
      const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
      const end = `${y}-${pad2(endMonth)}-${pad2(lastDay)}`;
      return { start, end };
    }
  }

  // "FY2023", "FY 2023", or just "2023"
  const fyMatch = s.match(/^(?:FY\s*)?(\d{4})$/i);
  if (fyMatch) {
    const y = Number(fyMatch[1]);
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }

  // "TTM", "YTD", "PY_YTD" — these are aggregate labels, not concrete periods
  if (/^(TTM|YTD|PY_YTD)$/i.test(s)) {
    return { start: null, end: null };
  }

  return { start: null, end: null };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthNameToNum(name: string): number | null {
  const map: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  return map[name.slice(0, 3).toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Batch fact writer
// ---------------------------------------------------------------------------

export async function writeFactsBatch(args: {
  dealId: string;
  bankId: string;
  sourceDocumentId: string;
  factType: string;
  items: ExtractedLineItem[];
}): Promise<ExtractionResult> {
  let factsWritten = 0;

  const writes = args.items.map((item) =>
    upsertDealFinancialFact({
      dealId: args.dealId,
      bankId: args.bankId,
      sourceDocumentId: args.sourceDocumentId,
      factType: args.factType,
      factKey: item.factKey,
      factValueNum: item.value,
      confidence: item.confidence,
      factPeriodStart: item.periodStart,
      factPeriodEnd: item.periodEnd,
      provenance: item.provenance,
    }),
  );

  const results = await Promise.all(writes);
  for (const r of results) {
    if (r.ok) factsWritten += 1;
  }

  return { ok: true, factsWritten };
}

// ---------------------------------------------------------------------------
// Rent roll row writer (direct to deal_rent_roll_rows)
// ---------------------------------------------------------------------------

export type ExtractedRentRollRow = {
  unit_id: string;
  unit_type: string | null;
  sqft: number | null;
  tenant_name: string | null;
  lease_start: string | null;
  lease_end: string | null;
  monthly_rent: number | null;
  annual_rent: number | null;
  market_rent_monthly: number | null;
  occupancy_status: "OCCUPIED" | "VACANT";
  concessions_monthly: number | null;
  notes: string | null;
};

export async function writeRentRollRows(args: {
  dealId: string;
  bankId: string;
  sourceDocumentId: string;
  asOfDate: string;
  rows: ExtractedRentRollRow[];
}): Promise<ExtractionResult> {
  if (!args.rows.length) return { ok: true, factsWritten: 0 };

  const sb = supabaseAdmin();

  // Delete existing rows from same source document to avoid duplicates on re-extraction
  await (sb as any)
    .from("deal_rent_roll_rows")
    .delete()
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .eq("source_document_id", args.sourceDocumentId);

  const rows = args.rows.map((r) => ({
    deal_id: args.dealId,
    bank_id: args.bankId,
    as_of_date: args.asOfDate,
    unit_id: r.unit_id,
    unit_type: r.unit_type,
    sqft: r.sqft,
    tenant_name: r.tenant_name,
    lease_start: r.lease_start,
    lease_end: r.lease_end,
    monthly_rent: r.monthly_rent,
    annual_rent: r.annual_rent,
    market_rent_monthly: r.market_rent_monthly,
    occupancy_status: r.occupancy_status,
    concessions_monthly: r.concessions_monthly,
    notes: r.notes,
    source_document_id: args.sourceDocumentId,
  }));

  const { error } = await (sb as any)
    .from("deal_rent_roll_rows")
    .insert(rows);

  if (error) {
    return { ok: false, factsWritten: 0, error: error.message };
  }

  return { ok: true, factsWritten: rows.length };
}
