/**
 * Form 1125-E Deterministic Extractor — Compensation of Officers
 *
 * Extracts officer names, time %, stock ownership %, compensation amounts,
 * and computes market rate reasonableness flag
 * per God Tier Phase 2 spec Layer 4D.
 * Pure deterministic extraction — regex, no LLMs.
 */

import type {
  DeterministicExtractorArgs,
  PureDeterministicResult,
  PureLineItem,
  ExtractionPath,
} from "./types";
import { parseMoney, resolveDocTaxYear } from "./parseUtils";
import { extractFormFields } from "./structuredJsonParser";

// ---------------------------------------------------------------------------
// Valid keys
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  "F1125E_OFFICER_NAME",
  "F1125E_OFFICER_SSN_LAST4",
  "F1125E_TIME_PCT",
  "F1125E_STOCK_PCT_COMMON",
  "F1125E_STOCK_PCT_PREFERRED",
  "F1125E_COMPENSATION",
  "F1125E_TOTAL_COMPENSATION",
]);

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// Total compensation line
const TOTAL_COMP_PATTERN = /(?:total\s+compensation|line\s+\d+\s+total).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i;

// Officer row pattern: captures name, optional SSN last 4, time%, stock%, compensation
// Typical layout: Name | XXX-XX-1234 | 100 | 50 | 0 | 250,000
const OFFICER_ROW_PATTERN = /^(?!total|name|officer)([A-Z][a-zA-Z\s,.'"-]+?)\s+(?:\d{3}-?\d{2}-?)?(\d{4})?\s+(\d{1,3})(?:%|\s)\s+(\d{1,3})(?:%|\s)\s+(\d{1,3})(?:%|\s)\s+(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/gm;

// Structured field patterns for individual columns
const NAME_PATTERN = /(?:name\s+of\s+officer|officer\s+name)[:\s]*(.+)/i;
const SSN_PATTERN = /(?:social\s+security|ssn|ss\s+no)[:\s]*(?:\d{3}-?\d{2}-?)?(\d{4})/i;
const TIME_PATTERN = /(?:time\s+devoted|percent\s+of\s+time|\%\s*of\s*time)[:\s]*(\d{1,3})/i;
const COMMON_STOCK_PATTERN = /(?:common\s+stock|stock\s+owned\s*%?\s*common)[:\s]*(\d{1,3})/i;
const PREFERRED_STOCK_PATTERN = /(?:preferred\s+stock|stock\s+owned\s*%?\s*preferred)[:\s]*(\d{1,3})/i;
const COMPENSATION_PATTERN = /(?:amount\s+of\s+compensation|compensation)[:\s]*(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i;

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractForm1125E(
  args: DeterministicExtractorArgs,
): PureDeterministicResult {
  const { ocrText, structuredJson, docYear } = args;
  const items: PureLineItem[] = [];
  let extractionPath: ExtractionPath = "ocr_regex";
  let factsAttempted = 0;

  const taxYear = resolveDocTaxYear(ocrText, docYear);
  const period = taxYear ? String(taxYear) : null;

  // -- Structured JSON --
  if (structuredJson) {
    const formFields = extractFormFields(structuredJson);
    if (formFields.length > 0) {
      extractionPath = "gemini_structured";
      for (const field of formFields) {
        // Officer name
        if (NAME_PATTERN.test(field.name)) {
          factsAttempted++;
          items.push({
            key: "F1125E_OFFICER_NAME",
            value: field.value.trim(),
            period,
            snippet: `${field.name}: ${field.value}`,
          });
        }
        // Compensation amounts
        if (COMPENSATION_PATTERN.test(field.name)) {
          const val = parseMoney(field.value);
          if (val !== null) {
            factsAttempted++;
            items.push({
              key: "F1125E_COMPENSATION",
              value: val,
              period,
              snippet: `${field.name}: ${field.value}`,
            });
          }
        }
      }
    }
  }

  // -- OCR regex — tabular rows --
  factsAttempted++;
  let rowMatch: RegExpExecArray | null;
  const rowRegex = new RegExp(OFFICER_ROW_PATTERN.source, OFFICER_ROW_PATTERN.flags);
  while ((rowMatch = rowRegex.exec(ocrText)) !== null) {
    const name = rowMatch[1].trim();
    const ssnLast4 = rowMatch[2] || null;
    const timePct = parseInt(rowMatch[3], 10);
    const commonPct = parseInt(rowMatch[4], 10);
    const preferredPct = parseInt(rowMatch[5], 10);
    const comp = parseMoney(rowMatch[6]);

    if (name && name.length > 1) {
      items.push({
        key: "F1125E_OFFICER_NAME",
        value: name,
        period,
        snippet: rowMatch[0].trim().slice(0, 120),
      });
    }
    if (ssnLast4) {
      items.push({
        key: "F1125E_OFFICER_SSN_LAST4",
        value: ssnLast4,
        period,
        snippet: `SSN last 4: ${ssnLast4}`,
      });
    }
    if (!isNaN(timePct)) {
      items.push({
        key: "F1125E_TIME_PCT",
        value: timePct,
        period,
        snippet: `Time devoted: ${timePct}%`,
      });
    }
    if (!isNaN(commonPct)) {
      items.push({
        key: "F1125E_STOCK_PCT_COMMON",
        value: commonPct,
        period,
        snippet: `Common stock: ${commonPct}%`,
      });
    }
    if (!isNaN(preferredPct)) {
      items.push({
        key: "F1125E_STOCK_PCT_PREFERRED",
        value: preferredPct,
        period,
        snippet: `Preferred stock: ${preferredPct}%`,
      });
    }
    if (comp !== null) {
      items.push({
        key: "F1125E_COMPENSATION",
        value: comp,
        period,
        snippet: `Compensation: ${rowMatch[6]}`,
      });
    }
  }

  // -- OCR regex — individual field patterns (fallback) --
  if (!items.some((i) => i.key === "F1125E_OFFICER_NAME")) {
    factsAttempted++;
    const nameMatch = ocrText.match(NAME_PATTERN);
    if (nameMatch) {
      items.push({
        key: "F1125E_OFFICER_NAME",
        value: nameMatch[1].trim(),
        period,
        snippet: nameMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
      });
    }
  }

  if (!items.some((i) => i.key === "F1125E_COMPENSATION")) {
    factsAttempted++;
    const compMatch = ocrText.match(COMPENSATION_PATTERN);
    if (compMatch) {
      const val = parseMoney(compMatch[1]);
      if (val !== null) {
        items.push({
          key: "F1125E_COMPENSATION",
          value: val,
          period,
          snippet: compMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
        });
      }
    }
  }

  // -- Total compensation --
  factsAttempted++;
  const totalMatch = ocrText.match(TOTAL_COMP_PATTERN);
  if (totalMatch) {
    const val = parseMoney(totalMatch[1]);
    if (val !== null) {
      items.push({
        key: "F1125E_TOTAL_COMPENSATION",
        value: val,
        period,
        snippet: totalMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
      });
    }
  }

  const validItems = items.filter((i) => VALID_LINE_KEYS.has(i.key));

  return {
    ok: validItems.length > 0,
    items: validItems,
    extractionPath,
    factsAttempted,
  };
}

// ---------------------------------------------------------------------------
// Officer compensation analysis (pure computation)
// ---------------------------------------------------------------------------

export type OfficerCompAnalysis = {
  officerName: string;
  reportedCompensation: number;
  timePct: number;
  fteEquivalent: number;
  aboveMarketRate: boolean;
  excessAmount: number;
};

/**
 * Assess officer compensation reasonableness per spec:
 * FTE Comp = Reported / Time% → if FTE > market rate, excess = add-back
 */
export function assessOfficerCompensation(
  officerName: string,
  reportedComp: number,
  timePct: number,       // 0–100
  marketRate: number,
): OfficerCompAnalysis {
  const pct = timePct > 0 ? timePct / 100 : 1;
  const fteEquivalent = reportedComp / pct;
  const aboveMarketRate = fteEquivalent > marketRate;
  const excessAmount = aboveMarketRate ? reportedComp - (marketRate * pct) : 0;

  return {
    officerName,
    reportedCompensation: reportedComp,
    timePct,
    fteEquivalent,
    aboveMarketRate,
    excessAmount,
  };
}
