import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

/**
 * POST /api/banks/policy/ingest
 *
 * Extract text from a bank_asset PDF and chunk it into bank_policy_chunks.
 *
 * Body:
 * {
 *   "asset_id": "uuid",
 *   "chunk_size": 500,  // optional, default 500 words
 *   "overlap": 50       // optional, default 50 words
 * }
 *
 * Returns:
 * {
 *   "chunks_created": 42,
 *   "chunks": [...chunk objects]
 * }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChunkResult {
  chunk_index: number;
  text: string;
  page_start: number;
  page_end: number;
  section_title: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const bankId = await getCurrentBankId();
    const body = await req.json();
    const { asset_id, chunk_size = 500, overlap = 50 } = body;

    if (!asset_id) {
      return NextResponse.json({ error: "asset_id required" }, { status: 400 });
    }

    // 1. Fetch the asset metadata
    const { data: asset, error: assetError } = await supabaseAdmin()
      .from("bank_assets")
      .select("id, bank_id, title, storage_path, kind")
      .eq("id", asset_id)
      .eq("bank_id", bankId)
      .single();

    if (assetError || !asset) {
      return NextResponse.json(
        { error: "Asset not found or access denied" },
        { status: 404 },
      );
    }

    // 2. Download the file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabaseAdmin()
      .storage.from("bank-assets")
      .download(asset.storage_path);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: `Download failed: ${downloadError?.message}` },
        { status: 500 },
      );
    }

    // 3. Extract text from PDF
    // For now, we'll use a simple text extraction approach
    // In production, you'd use pdf-parse or similar library
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Simple text extraction (placeholder - replace with actual PDF parsing)
    const extractedText = await extractTextFromPDF(buffer);

    if (!extractedText) {
      return NextResponse.json(
        { error: "Failed to extract text from PDF" },
        { status: 500 },
      );
    }

    // 4. Chunk the text
    const chunks = chunkText(extractedText, chunk_size, overlap);

    // 5. Insert chunks into database
    const chunksToInsert = chunks.map((chunk, idx) => ({
      bank_id: bankId,
      asset_id: asset.id,
      chunk_index: idx,
      text: chunk.text,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      section_title: chunk.section_title,
    }));

    const { data: insertedChunks, error: insertError } = await supabaseAdmin()
      .from("bank_policy_chunks")
      .insert(chunksToInsert)
      .select();

    if (insertError) {
      return NextResponse.json(
        { error: `Insert failed: ${insertError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      chunks_created: insertedChunks?.length || 0,
      chunks: insertedChunks,
    });
  } catch (err: any) {
    console.error("[/api/banks/policy/ingest] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Extract text from PDF buffer
 *
 * Note: This is a placeholder implementation. In production, use a proper
 * PDF parsing library like pdf-parse, pdfjs-dist, or call an external API.
 */
async function extractTextFromPDF(buffer: Buffer): Promise<string | null> {
  try {
    // Option 1: Use pdf-parse (requires: npm install pdf-parse)
    // const pdfParse = require('pdf-parse');
    // const data = await pdfParse(buffer);
    // return data.text;

    // Option 2: Placeholder - return dummy text for now
    // Replace this with actual PDF parsing in production
    return `
# Sample Loan Policy Document

## Commercial Real Estate Lending

### Loan-to-Value (LTV) Requirements
Maximum LTV for CRE loans is 80% of appraised value. Properties with higher risk profiles may require lower LTV ratios.

### Debt Service Coverage Ratio (DSCR)
Minimum DSCR of 1.25x required for all commercial real estate loans. Properties with stable, long-term tenants may qualify at 1.15x with additional collateral.

## SBA Lending Guidelines

### SBA 7(a) Loans
- Maximum loan amount: $5,000,000
- Minimum credit score: 680
- Minimum time in business: 2 years
- Maximum LTV: 90% for real estate, 85% for equipment

### Debt Service Coverage
All SBA loans require minimum DSCR of 1.15x calculated on global cash flow.

## Term Loans

### General Requirements
- Maximum loan amount: $5,000,000 without executive approval
- Minimum FICO score: 660
- Maximum term: 7 years for equipment, 25 years for real estate

### Owner-Occupied Real Estate
Owner-occupied properties require minimum 10% cash injection from borrower equity.

## Equipment Financing

### Credit Requirements
Minimum FICO score of 660 for all equipment loans. Borrowers with scores below 680 require additional collateral coverage.

### Loan Terms
- Maximum 7-year term
- Maximum 85% LTV
- Minimum 15% down payment required
    `.trim();
  } catch (err) {
    console.error("PDF extraction error:", err);
    return null;
  }
}

/**
 * Chunk text into overlapping segments
 */
function chunkText(
  text: string,
  chunkSize: number,
  overlap: number,
): ChunkResult[] {
  const words = text.split(/\s+/);
  const chunks: ChunkResult[] = [];

  const currentPage = 1;
  let currentSection: string | null = null;

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunkWords = words.slice(i, i + chunkSize);
    const chunkText = chunkWords.join(" ");

    // Simple section detection (lines starting with #)
    const sectionMatch = chunkText.match(/^#+ (.+)/m);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
    }

    // Estimate page numbers (rough heuristic: 300 words per page)
    const startPage = Math.floor(i / 300) + 1;
    const endPage = Math.floor((i + chunkWords.length) / 300) + 1;

    chunks.push({
      chunk_index: chunks.length,
      text: chunkText,
      page_start: startPage,
      page_end: endPage,
      section_title: currentSection,
    });
  }

  return chunks;
}
