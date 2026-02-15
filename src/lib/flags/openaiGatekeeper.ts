/**
 * OpenAI Gatekeeper Feature Flag
 *
 * Hard gate controlling whether the OpenAI Gatekeeper classifier runs
 * during orchestrateIntake(). When OFF (default), docs flow through
 * the existing keyword-based classify_documents step unchanged.
 *
 * This is the SINGLE SOURCE OF TRUTH — no other file should
 * read ENABLE_OPENAI_GATEKEEPER directly.
 *
 * Flip procedure: set ENABLE_OPENAI_GATEKEEPER=true in environment, redeploy.
 */
export function isOpenAiGatekeeperEnabled(): boolean {
  return (
    String(process.env.ENABLE_OPENAI_GATEKEEPER ?? "").toLowerCase() === "true"
  );
}
