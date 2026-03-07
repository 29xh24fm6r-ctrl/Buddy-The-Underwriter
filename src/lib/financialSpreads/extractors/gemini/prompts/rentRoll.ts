/**
 * Gemini-Primary Prompt — Rent Roll
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_rr_v1";

const EXPECTED_KEYS = [
  "TOTAL_UNITS",
  "OCCUPIED_UNITS",
  "VACANT_UNITS",
  "OCCUPANCY_PCT",
  "TOTAL_MONTHLY_RENT",
  "TOTAL_ANNUAL_RENT",
  "AVG_RENT_PER_UNIT",
  "TOTAL_SQFT",
];

export function buildRentRollPrompt(
  ocrText: string,
): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "RENT_ROLL",
    expectedKeys: EXPECTED_KEYS,
    userPrompt:
      "Extract the following summary-level data from this rent roll document.\n\n" +
      "Monetary/numeric facts (use the exact keys shown):\n" +
      "- TOTAL_UNITS: Total number of units\n" +
      "- OCCUPIED_UNITS: Number of occupied units\n" +
      "- VACANT_UNITS: Number of vacant units\n" +
      "- OCCUPANCY_PCT: Occupancy percentage (as a decimal, e.g. 0.95 for 95%)\n" +
      "- TOTAL_MONTHLY_RENT: Total monthly rent (sum of all unit rents)\n" +
      "- TOTAL_ANNUAL_RENT: Total annual rent\n" +
      "- AVG_RENT_PER_UNIT: Average rent per unit (monthly)\n" +
      "- TOTAL_SQFT: Total square footage\n\n" +
      "If the document lists individual units, compute the totals. " +
      "For OCCUPANCY_PCT, if not stated explicitly, calculate as OCCUPIED_UNITS / TOTAL_UNITS.\n\n" +
      "Metadata:\n" +
      "- entity_name: Property name\n" +
      "- period_start: Rent roll as-of date\n\n" +
      RESPONSE_FORMAT_INSTRUCTION +
      "\n\nDocument text:\n" +
      ocrText,
  };
}
