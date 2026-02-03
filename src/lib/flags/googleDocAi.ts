/**
 * Google Document AI Feature Flag
 *
 * Hard gate controlling whether Google Document AI is allowed to execute.
 * When OFF (default), all documents fall back to Gemini OCR regardless of
 * routing_class. When ON, DOC_AI_ATOMIC documents route to Document AI.
 *
 * This is the SINGLE SOURCE OF TRUTH for the flag — no other file should
 * read GOOGLE_DOCAI_ENABLED directly.
 *
 * Flip procedure: set GOOGLE_DOCAI_ENABLED=true in environment, redeploy.
 */
export function isGoogleDocAiEnabled(): boolean {
  return String(process.env.GOOGLE_DOCAI_ENABLED ?? "").toLowerCase() === "true";
}
