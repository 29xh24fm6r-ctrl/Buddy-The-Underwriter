import "server-only";

/**
 * Gemini-Primary Document Extractor — Orchestrator
 *
 * Routes doc types to the appropriate Gemini prompt, calls the client,
 * parses the response into ExtractedLineItem[].
 *
 * NEVER THROWS — returns { ok: false, failureReason } on any failure.
 */

import { callGeminiForExtraction } from "./geminiClient";
import { parseGeminiResponse } from "./geminiResponseParser";
import { normalizePeriod } from "../shared";
import type { GeminiExtractionPrompt, GeminiExtractionResult } from "./types";

// Prompt builders
import { buildBusinessTaxReturnPrompt, buildBusinessTaxReturnPromptForPdf } from "./prompts/businessTaxReturn";
import { buildPersonalTaxReturnPrompt, buildPersonalTaxReturnPromptForPdf } from "./prompts/personalTaxReturn";
import { buildBalanceSheetPrompt, buildBalanceSheetPromptForPdf } from "./prompts/balanceSheet";
import { buildIncomeStatementPrompt, buildIncomeStatementPromptForPdf } from "./prompts/incomeStatement";
import { buildRentRollPrompt, buildRentRollPromptForPdf } from "./prompts/rentRoll";
import { buildPfsPrompt, buildPfsPromptForPdf } from "./prompts/personalFinancialStatement";
import { buildBankStatementPrompt, buildBankStatementPromptForPdf } from "./prompts/bankStatement";
import { buildDebtSchedulePrompt, buildDebtSchedulePromptForPdf } from "./prompts/debtSchedule";

// ---------------------------------------------------------------------------
// Doc type → prompt + factType mapping
// ---------------------------------------------------------------------------

type DocTypeConfig = {
  buildPrompt: (ocrText: string) => GeminiExtractionPrompt;
  buildPromptForPdf: () => GeminiExtractionPrompt;
  factType: string;
};

function getDocTypeConfig(
  normDocType: string,
): DocTypeConfig | null {
  switch (normDocType) {
    case "IRS_1120":
    case "IRS_1120S":
    case "IRS_1065":
    case "IRS_BUSINESS":
    case "BUSINESS_TAX_RETURN":
    case "TAX_RETURN":
      return {
        buildPrompt: buildBusinessTaxReturnPrompt,
        buildPromptForPdf: buildBusinessTaxReturnPromptForPdf,
        factType: "TAX_RETURN",
      };

    case "IRS_1040":
    case "IRS_PERSONAL":
    case "PERSONAL_TAX_RETURN":
      return {
        buildPrompt: buildPersonalTaxReturnPrompt,
        buildPromptForPdf: buildPersonalTaxReturnPromptForPdf,
        factType: "PERSONAL_INCOME",
      };

    case "BALANCE_SHEET":
      return {
        buildPrompt: buildBalanceSheetPrompt,
        buildPromptForPdf: buildBalanceSheetPromptForPdf,
        factType: "BALANCE_SHEET",
      };

    case "FINANCIAL_STATEMENT":
    case "INCOME_STATEMENT":
    case "OPERATING_STATEMENT":
      return {
        buildPrompt: buildIncomeStatementPrompt,
        buildPromptForPdf: buildIncomeStatementPromptForPdf,
        factType: "INCOME_STATEMENT",
      };

    case "RENT_ROLL":
      return {
        buildPrompt: buildRentRollPrompt,
        buildPromptForPdf: buildRentRollPromptForPdf,
        factType: "RENT_ROLL",
      };

    case "PFS":
    case "PERSONAL_FINANCIAL_STATEMENT":
    case "SBA_413":
      return {
        buildPrompt: buildPfsPrompt,
        buildPromptForPdf: buildPfsPromptForPdf,
        factType: "PFS",
      };

    case "BANK_STATEMENT":
      return {
        buildPrompt: buildBankStatementPrompt,
        buildPromptForPdf: buildBankStatementPromptForPdf,
        factType: "BANK_STATEMENT",
      };

    case "DEBT_SCHEDULE":
    case "SCHEDULE_OF_OBLIGATIONS":
      return {
        buildPrompt: buildDebtSchedulePrompt,
        buildPromptForPdf: buildDebtSchedulePromptForPdf,
        factType: "DEBT_SCHEDULE",
      };

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function extractWithGeminiPrimary(args: {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
  docType: string;
  docYear?: number | null;
  ownerEntityId?: string | null;
  /** When present, sends native PDF via inlineData instead of OCR text */
  pdfBase64?: string;
  mimeType?: string;
}): Promise<GeminiExtractionResult> {
  const emptyResult = (
    failureReason: string,
    latencyMs = 0,
  ): GeminiExtractionResult => ({
    ok: false,
    items: [],
    rawResponse: null,
    latencyMs,
    model: "gemini-2.0-flash",
    promptVersion: "",
    failureReason,
  });

  try {
    // 1. Select prompt based on doc type
    const config = getDocTypeConfig(args.docType);
    if (!config) {
      return emptyResult("unsupported_doc_type");
    }

    // 2. Build prompt — native PDF path skips OCR text in prompt
    const prompt = args.pdfBase64
      ? config.buildPromptForPdf()
      : config.buildPrompt(args.ocrText);

    // 3. Call Gemini
    const clientResult = await callGeminiForExtraction({
      prompt,
      documentId: args.documentId,
      pdfBase64: args.pdfBase64,
      mimeType: args.mimeType,
    });

    if (!clientResult.ok || !clientResult.rawJson) {
      return emptyResult(
        clientResult.failureReason ?? "client_failure",
        clientResult.latencyMs,
      );
    }

    // 4. Resolve periods
    let periodStart: string | null = null;
    let periodEnd: string | null = null;

    // Try metadata first (will be resolved in parser), fall back to docYear
    if (args.docYear) {
      periodStart = `${args.docYear}-01-01`;
      periodEnd = `${args.docYear}-12-31`;
    }

    // For metadata-based period resolution, check the raw response
    const rawObj = clientResult.rawJson as Record<string, unknown>;
    const metadata = rawObj.metadata as Record<string, unknown> | undefined;
    if (metadata) {
      if (
        typeof metadata.tax_year === "number" &&
        metadata.tax_year > 1900
      ) {
        periodStart = `${metadata.tax_year}-01-01`;
        periodEnd = `${metadata.tax_year}-12-31`;
      } else if (typeof metadata.period_start === "string") {
        const normalized = normalizePeriod(metadata.period_start as string);
        if (normalized.start) periodStart = normalized.start;
        if (normalized.end) periodEnd = normalized.end;
      }
      if (typeof metadata.period_end === "string") {
        const normalized = normalizePeriod(metadata.period_end as string);
        if (normalized.end) periodEnd = normalized.end;
      }
    }

    // 5. Parse response into ExtractedLineItem[]
    const { items, rawResponse } = parseGeminiResponse({
      rawJson: clientResult.rawJson,
      expectedKeys: prompt.expectedKeys,
      docType: args.docType,
      documentId: args.documentId,
      factType: config.factType,
      periodStart,
      periodEnd,
    });

    // 6. Schedule C/E/K1 detection for personal tax returns
    //    Write detection flags as facts so the checklist engine can
    //    let a PTR with Schedule C satisfy the BTR requirement.
    if (config.factType === "PERSONAL_INCOME" || config.factType === "TAX_RETURN") {
      const facts = rawObj.facts as Record<string, unknown> | undefined;

      const hasScheduleC = !!(
        (facts?.SCHEDULE_C_NET_PROFIT && Number(facts.SCHEDULE_C_NET_PROFIT) !== 0) ||
        (facts?.SCHEDULE_C_GROSS_RECEIPTS && Number(facts.SCHEDULE_C_GROSS_RECEIPTS) !== 0) ||
        metadata?.schedule_c_present === true
      );
      const hasScheduleE = !!(
        (facts?.SCHEDULE_E_GROSS_RENTS && Number(facts.SCHEDULE_E_GROSS_RENTS) !== 0) ||
        (facts?.RENTAL_INCOME_SCHED_E && Number(facts.RENTAL_INCOME_SCHED_E) !== 0) ||
        metadata?.schedule_e_present === true
      );
      const hasK1 = !!(
        (facts?.K1_ORDINARY_INCOME && Number(facts.K1_ORDINARY_INCOME) !== 0) ||
        metadata?.k1_present === true
      );

      const detectionProvenance = {
        source_type: "DOC_EXTRACT" as const,
        source_ref: `deal_documents:${args.documentId}`,
        as_of_date: periodEnd,
        extractor: "gemini_primary_schedule_detect",
        confidence: 0.90,
      };

      if (hasScheduleC) {
        items.push({
          factKey: "PTR_HAS_SCHEDULE_C",
          value: 1,
          confidence: 0.90,
          periodStart,
          periodEnd,
          provenance: detectionProvenance,
        });
      }
      if (hasScheduleE) {
        items.push({
          factKey: "PTR_HAS_SCHEDULE_E",
          value: 1,
          confidence: 0.90,
          periodStart,
          periodEnd,
          provenance: detectionProvenance,
        });
      }
      if (hasK1) {
        items.push({
          factKey: "PTR_HAS_K1",
          value: 1,
          confidence: 0.90,
          periodStart,
          periodEnd,
          provenance: detectionProvenance,
        });
      }

      if (hasScheduleC || hasScheduleE || hasK1) {
        console.log("[GeminiDocumentExtractor] Schedule detection", {
          documentId: args.documentId,
          hasScheduleC,
          hasScheduleE,
          hasK1,
        });
      }
    }

    console.log("[GeminiDocumentExtractor] Extraction completed", {
      documentId: args.documentId,
      docType: args.docType,
      itemCount: items.length,
      latencyMs: clientResult.latencyMs,
      promptVersion: prompt.promptVersion,
    });

    return {
      ok: items.length > 0,
      items,
      rawResponse,
      latencyMs: clientResult.latencyMs,
      model: clientResult.model,
      promptVersion: prompt.promptVersion,
      failureReason: items.length === 0 ? "zero_items_parsed" : undefined,
    };
  } catch (err: any) {
    console.warn("[GeminiDocumentExtractor] Failed", {
      documentId: args.documentId,
      docType: args.docType,
      error: err?.message || String(err),
    });
    return emptyResult(err?.message || "unknown_error");
  }
}
