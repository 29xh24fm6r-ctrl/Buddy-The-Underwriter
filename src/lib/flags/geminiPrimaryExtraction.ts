/**
 * Gemini-Primary Extraction Feature Flag
 *
 * Controls whether Gemini 2.0 Flash is used as the PRIMARY fact extractor
 * (writing facts directly) vs the current deterministic-primary pipeline.
 *
 * When OFF (default): deterministic extractors are primary, Gemini runs in
 *   shadow mode for comparison telemetry only. Zero behavior change.
 * When ON: Gemini is primary (writes facts), deterministic runs as cross-check.
 *   If Gemini fails, deterministic takes over as fallback.
 *
 * This is the SINGLE SOURCE OF TRUTH for the flag — no other file should
 * read GEMINI_PRIMARY_EXTRACTION_ENABLED directly.
 *
 * Flip procedure: set GEMINI_PRIMARY_EXTRACTION_ENABLED=true in environment, redeploy.
 */
export function isGeminiPrimaryExtractionEnabled(): boolean {
  return String(process.env.GEMINI_PRIMARY_EXTRACTION_ENABLED ?? "").toLowerCase() === "true";
}
