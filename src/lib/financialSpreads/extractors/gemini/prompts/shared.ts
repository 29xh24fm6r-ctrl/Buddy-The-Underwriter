/**
 * Shared prompt constants for Gemini-Primary extraction prompts.
 *
 * Pure constants — no server imports.
 */

export const SYSTEM_PREFIX =
  "You are a financial document extraction engine for commercial lending underwriting. " +
  "Extract ONLY the requested fields from the provided document text. " +
  "Return strict JSON only — no commentary, no markdown, no explanation. " +
  "For monetary values use plain numbers (no currency symbols, no commas). " +
  "Negative amounts should be negative numbers. " +
  "Use null for any field you cannot confidently extract. " +
  "Do NOT infer, interpolate, or compute values that are not explicitly stated in the document. " +
  "If a value appears in parentheses (e.g. (5000)), treat it as negative (-5000).";

export const RESPONSE_FORMAT_INSTRUCTION =
  'Return a JSON object with exactly this structure:\n' +
  '{\n' +
  '  "facts": {\n' +
  '    "CANONICAL_KEY": <number or null>,\n' +
  '    ...\n' +
  '  },\n' +
  '  "metadata": {\n' +
  '    "tax_year": <number or null>,\n' +
  '    "entity_name": "<string or null>",\n' +
  '    "form_type": "<string or null>",\n' +
  '    "period_start": "<YYYY-MM-DD or null>",\n' +
  '    "period_end": "<YYYY-MM-DD or null>",\n' +
  '    "ein": "<XX-XXXXXXX or null>",\n' +
  '    "taxpayer_name": "<string or null>",\n' +
  '    "filing_status": "<string or null>"\n' +
  '  }\n' +
  '}\n' +
  "Include ONLY the keys listed above in facts. " +
  "Do not add extra keys. Use null for any value not found in the document.";
