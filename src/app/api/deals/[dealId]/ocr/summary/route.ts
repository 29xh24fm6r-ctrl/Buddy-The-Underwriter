import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

type ExtractedField = {
  field: string;
  value: string | number | null;
  source: string;
  confidence: number | null;
  documentId: string;
  documentName: string;
  pageNumber?: number;
};

type DocumentSummary = {
  id: string;
  filename: string;
  docType: string | null;
  docYear: number | null;
  docYears: number[] | null;
  confidence: number | null;
  hasOcr: boolean;
  ocrProvider: string | null;
  textLength: number | null;
  classifiedAt: string | null;
};

type OcrSummaryResponse = {
  ok: boolean;
  dealId: string;
  stats: {
    totalDocuments: number;
    documentsWithOcr: number;
    documentsClassified: number;
    documentsUnknown: number;
  };
  documents: DocumentSummary[];
  extractedFields: ExtractedField[];
  financialData: {
    taxYears: number[];
    businessTaxReturns: number;
    personalTaxReturns: number;
    financialStatements: number;
    bankStatements: number;
    otherDocuments: number;
  };
};

/**
 * GET /api/deals/[dealId]/ocr/summary
 *
 * Returns a summary of all OCR-extracted data for a deal.
 * This endpoint aggregates:
 * - All document_ocr_results
 * - All doc_intel_results
 * - deal_documents metadata
 * 
 * Useful for showing bankers what data has been extracted from PDFs.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Params }
): Promise<NextResponse> {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { dealId } = await ctx.params;

    // Verify deal access
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 }
      );
    }

    const sb = supabaseAdmin();

    // Fetch all documents for this deal
    const { data: documents, error: docsError } = await sb
      .from("deal_documents")
      .select(`
        id,
        original_filename,
        document_type,
        doc_year,
        doc_years,
        match_confidence,
        match_source,
        checklist_key,
        created_at
      `)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });

    if (docsError) {
      console.error("[ocr/summary] docs fetch error:", docsError);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch documents" },
        { status: 500 }
      );
    }

    // Fetch OCR results
    const { data: ocrResults, error: ocrError } = await sb
      .from("document_ocr_results")
      .select(`
        attachment_id,
        provider,
        status,
        extracted_text,
        updated_at
      `)
      .eq("deal_id", dealId);

    // Fetch doc intel results
    const { data: intelResults, error: intelError } = await sb
      .from("doc_intel_results")
      .select(`
        file_id,
        doc_type,
        tax_year,
        confidence,
        extracted_json,
        created_at
      `)
      .eq("deal_id", dealId);

    // Build lookup maps
    const ocrMap = new Map<string, any>();
    for (const ocr of ocrResults || []) {
      ocrMap.set(ocr.attachment_id, ocr);
    }

    const intelMap = new Map<string, any>();
    for (const intel of intelResults || []) {
      intelMap.set(intel.file_id, intel);
    }

    // Build document summaries
    const documentSummaries: DocumentSummary[] = [];
    let documentsWithOcr = 0;
    let documentsClassified = 0;
    let documentsUnknown = 0;
    let businessTaxReturns = 0;
    let personalTaxReturns = 0;
    let financialStatements = 0;
    let bankStatements = 0;
    let otherDocuments = 0;
    const taxYearsSet = new Set<number>();

    for (const doc of documents || []) {
      const ocr = ocrMap.get(doc.id);
      const intel = intelMap.get(doc.id);

      const docType = doc.document_type || intel?.doc_type || null;
      const docYear = doc.doc_year || intel?.tax_year || null;
      const docYears = doc.doc_years || null;
      const confidence = doc.match_confidence || intel?.confidence || null;
      const hasOcr = !!ocr && ocr.status === "SUCCEEDED";
      const textLength = ocr?.extracted_text?.length || null;

      // Categorize document types
      const dtLower = String(docType || "").toLowerCase();
      if (dtLower.includes("business_tax") || dtLower.includes("1120") || dtLower.includes("1065")) {
        businessTaxReturns++;
      } else if (dtLower.includes("personal_tax") || dtLower.includes("1040")) {
        personalTaxReturns++;
      } else if (dtLower.includes("income_statement") || dtLower.includes("balance_sheet") || dtLower.includes("financial_statement")) {
        financialStatements++;
      } else if (dtLower.includes("bank_statement")) {
        bankStatements++;
      } else if (docType && dtLower !== "unknown") {
        otherDocuments++;
      }

      // Track years
      if (docYear && docYear > 2000 && docYear < 2040) {
        taxYearsSet.add(docYear);
      }
      if (docYears && Array.isArray(docYears)) {
        for (const y of docYears) {
          if (y > 2000 && y < 2040) taxYearsSet.add(y);
        }
      }

      // Stats
      if (hasOcr) documentsWithOcr++;
      if (docType && dtLower !== "unknown") {
        documentsClassified++;
      } else {
        documentsUnknown++;
      }

      documentSummaries.push({
        id: doc.id,
        filename: doc.original_filename || "Unknown",
        docType,
        docYear,
        docYears,
        confidence: typeof confidence === "number" ? Math.round(confidence * 100) / 100 : null,
        hasOcr,
        ocrProvider: ocr?.provider || null,
        textLength,
        classifiedAt: intel?.created_at || null,
      });
    }

    // Extract key financial fields from doc intel results
    const extractedFields: ExtractedField[] = [];

    for (const intel of intelResults || []) {
      const doc = documents?.find((d) => d.id === intel.file_id);
      const extracted = intel.extracted_json;

      if (extracted && typeof extracted === "object") {
        // Look for common financial fields in the extracted JSON
        const det = (extracted as any)?.det;
        if (det) {
          if (det.document_type && det.document_type !== "unknown") {
            extractedFields.push({
              field: "Document Type",
              value: det.document_type,
              source: "AI Classification",
              confidence: det.confidence || null,
              documentId: intel.file_id,
              documentName: doc?.original_filename || "Unknown",
            });
          }
          if (det.doc_year) {
            extractedFields.push({
              field: "Tax Year",
              value: det.doc_year,
              source: "AI Classification",
              confidence: det.confidence || null,
              documentId: intel.file_id,
              documentName: doc?.original_filename || "Unknown",
            });
          }
        }
      }
    }

    const response: OcrSummaryResponse = {
      ok: true,
      dealId,
      stats: {
        totalDocuments: documents?.length || 0,
        documentsWithOcr,
        documentsClassified,
        documentsUnknown,
      },
      documents: documentSummaries,
      extractedFields,
      financialData: {
        taxYears: Array.from(taxYearsSet).sort((a, b) => b - a),
        businessTaxReturns,
        personalTaxReturns,
        financialStatements,
        bankStatements,
        otherDocuments,
      },
    };

    return NextResponse.json(response, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/ocr/summary] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "internal_error" },
      { status: 500 }
    );
  }
}
