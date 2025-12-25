import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

/**
 * POST /api/banks/policy/extract-defaults
 *
 * Extract default values from policy chunks using AI/pattern matching.
 *
 * Body:
 * {
 *   "asset_id": "uuid",              // optional: extract from specific asset
 *   "deal_type": "sba_7a",           // optional: scope to deal type
 *   "extract_mode": "pattern"        // "pattern" or "ai" (future)
 * }
 *
 * Returns:
 * {
 *   "extracted": 5,
 *   "defaults": [...default objects]
 * }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExtractedDefault {
  field_name: string;
  field_label: string;
  field_type: string;
  default_value: string;
  chunk_id?: string;
  confidence_score: number;
  source_text: string;
  min_value?: number;
  max_value?: number;
}

export async function POST(req: NextRequest) {
  try {
    const bankId = await getCurrentBankId();
    const body = await req.json();
    const { asset_id, deal_type, extract_mode = "pattern" } = body;

    // 1. Fetch chunks to analyze
    let query = supabaseAdmin()
      .from("bank_policy_chunks")
      .select("id, text, section_title")
      .eq("bank_id", bankId);

    if (asset_id) {
      query = query.eq("asset_id", asset_id);
    }

    const { data: chunks, error: chunksError } = await query;

    if (chunksError) {
      return NextResponse.json({ error: chunksError.message }, { status: 500 });
    }

    if (!chunks || chunks.length === 0) {
      return NextResponse.json(
        { error: "No chunks found to extract from" },
        { status: 404 },
      );
    }

    // 2. Extract defaults using pattern matching
    const extractedDefaults: ExtractedDefault[] = [];

    for (const chunk of chunks) {
      const defaults = extractFromChunk(chunk.text, chunk.id, deal_type);
      extractedDefaults.push(...defaults);
    }

    // 3. Deduplicate and insert into database
    const uniqueDefaults = deduplicateDefaults(extractedDefaults);

    const defaultsToInsert = uniqueDefaults.map((d) => ({
      bank_id: bankId,
      deal_type: deal_type || null,
      industry: null,
      field_name: d.field_name,
      field_label: d.field_label,
      field_type: d.field_type,
      default_value: d.default_value,
      chunk_id: d.chunk_id || null,
      confidence_score: d.confidence_score,
      source_text: d.source_text,
      min_value: d.min_value || null,
      max_value: d.max_value || null,
    }));

    // Upsert (insert or update if exists)
    const { data: inserted, error: insertError } = await supabaseAdmin()
      .from("bank_policy_defaults")
      .upsert(defaultsToInsert, {
        onConflict: "bank_id,deal_type,industry,field_name",
      })
      .select();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      extracted: inserted?.length || 0,
      defaults: inserted,
    });
  } catch (err: any) {
    console.error("[/api/banks/policy/extract-defaults] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Extract defaults from a chunk using pattern matching
 */
function extractFromChunk(
  text: string,
  chunkId: string,
  dealType?: string,
): ExtractedDefault[] {
  const extracted: ExtractedDefault[] = [];

  // Pattern 1: Interest Rate
  // "Interest rate is Prime + 2.75%" or "Priced at Prime + 2.75%"
  const interestRatePattern =
    /(?:interest rate|priced at|rate)[:\s]+(?:is\s+)?(Prime \+ [\d.]+%|[\d.]+%)/gi;
  let match = interestRatePattern.exec(text);
  if (match) {
    extracted.push({
      field_name: "interest_rate",
      field_label: "Interest Rate",
      field_type: "text",
      default_value: JSON.stringify(match[1]),
      chunk_id: chunkId,
      confidence_score: 0.85,
      source_text: match[0],
    });
  }

  // Pattern 2: Maximum LTV
  // "Maximum LTV is 80%" or "LTV not to exceed 80%"
  const ltvPattern =
    /(?:maximum LTV|max LTV|LTV)[:\s]+(?:is\s+|not to exceed\s+)?([\d.]+)%/gi;
  match = ltvPattern.exec(text);
  if (match) {
    const ltv = parseFloat(match[1]);
    extracted.push({
      field_name: "max_ltv",
      field_label: "Maximum LTV (%)",
      field_type: "percentage",
      default_value: match[1],
      chunk_id: chunkId,
      confidence_score: 0.9,
      source_text: match[0],
      max_value: ltv,
    });
  }

  // Pattern 3: Minimum DSCR
  // "Minimum DSCR of 1.25x" or "DSCR must be at least 1.15"
  const dscrPattern =
    /(?:minimum DSCR|DSCR)[:\s]+(?:of\s+|must be at least\s+)?([\d.]+)x?/gi;
  match = dscrPattern.exec(text);
  if (match) {
    const dscr = parseFloat(match[1]);
    extracted.push({
      field_name: "min_dscr",
      field_label: "Minimum DSCR",
      field_type: "number",
      default_value: match[1],
      chunk_id: chunkId,
      confidence_score: 0.9,
      source_text: match[0],
      min_value: dscr,
    });
  }

  // Pattern 4: Minimum FICO
  // "Minimum credit score: 660" or "FICO score of at least 680"
  const ficoPattern =
    /(?:minimum credit score|minimum FICO|FICO score)[:\s]+(?:of\s+)?(?:at least\s+)?([\d]+)/gi;
  match = ficoPattern.exec(text);
  if (match) {
    const fico = parseInt(match[1]);
    extracted.push({
      field_name: "min_fico",
      field_label: "Minimum FICO Score",
      field_type: "number",
      default_value: match[1],
      chunk_id: chunkId,
      confidence_score: 0.95,
      source_text: match[0],
      min_value: fico,
    });
  }

  // Pattern 5: Loan Term
  // "Maximum term: 7 years" or "Term of 10 years"
  const termPattern = /(?:maximum term|term)[:\s]+(?:of\s+)?([\d]+)\s+years?/gi;
  match = termPattern.exec(text);
  if (match) {
    const years = parseInt(match[1]);
    const months = years * 12;
    extracted.push({
      field_name: "term_months",
      field_label: "Loan Term (Months)",
      field_type: "number",
      default_value: months.toString(),
      chunk_id: chunkId,
      confidence_score: 0.85,
      source_text: match[0],
      max_value: months,
    });
  }

  // Pattern 6: Down Payment
  // "Minimum 10% down payment" or "Borrower equity: 15%"
  const downPaymentPattern =
    /(?:minimum|borrower equity|down payment)[:\s]+(?:of\s+)?([\d.]+)%/gi;
  match = downPaymentPattern.exec(text);
  if (match) {
    const pct = parseFloat(match[1]);
    extracted.push({
      field_name: "down_payment_pct",
      field_label: "Down Payment (%)",
      field_type: "percentage",
      default_value: match[1],
      chunk_id: chunkId,
      confidence_score: 0.8,
      source_text: match[0],
      min_value: pct,
    });
  }

  // Pattern 7: Guarantee Fee
  // "SBA guarantee fee is 2%" or "Guarantee fee: 2.0%"
  const guaranteeFeePattern =
    /(?:guarantee fee|SBA fee)[:\s]+(?:is\s+)?([\d.]+)%/gi;
  match = guaranteeFeePattern.exec(text);
  if (match) {
    extracted.push({
      field_name: "guarantee_fee",
      field_label: "SBA Guarantee Fee (%)",
      field_type: "percentage",
      default_value: match[1],
      chunk_id: chunkId,
      confidence_score: 0.95,
      source_text: match[0],
    });
  }

  // Pattern 8: Maximum Loan Amount
  // "Maximum loan amount: $5,000,000" or "Loans up to $2.5M"
  const maxAmountPattern =
    /(?:maximum loan amount|loans up to)[:\s]+\$?([\d,]+(?:M|million)?)/gi;
  match = maxAmountPattern.exec(text);
  if (match) {
    let amount = match[1].replace(/,/g, "");
    if (amount.endsWith("M") || amount.endsWith("million")) {
      amount = amount.replace(/M|million/g, "");
      amount = (parseFloat(amount) * 1000000).toString();
    }
    extracted.push({
      field_name: "max_loan_amount",
      field_label: "Maximum Loan Amount",
      field_type: "currency",
      default_value: amount,
      chunk_id: chunkId,
      confidence_score: 0.9,
      source_text: match[0],
      max_value: parseFloat(amount),
    });
  }

  return extracted;
}

/**
 * Deduplicate extracted defaults (keep highest confidence)
 */
function deduplicateDefaults(defaults: ExtractedDefault[]): ExtractedDefault[] {
  const map = new Map<string, ExtractedDefault>();

  for (const def of defaults) {
    const existing = map.get(def.field_name);
    if (!existing || def.confidence_score > existing.confidence_score) {
      map.set(def.field_name, def);
    }
  }

  return Array.from(map.values());
}
