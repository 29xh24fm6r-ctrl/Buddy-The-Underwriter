export type ResearchResult = {
  company?: string;
  industry?: string;
  owner?: string;
  sources?: { title: string; url?: string }[];
};

/**
 * Not implemented. This function previously returned hardcoded placeholder
 * strings ("Company research pending.") wrapped in an { ok: true } response
 * by its caller — indistinguishable from real research that legitimately
 * found nothing. See specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P0-6.
 *
 * The real, institutional-grade research pipeline is the Buddy Intelligence
 * Engine (src/lib/research/buddyIntelligenceEngine.ts), triggered via
 * POST /api/deals/[dealId]/research/run and read back via
 * src/lib/creditMemo/canonical/loadResearchForMemo.ts. Callers that want
 * research on a memo should use that pipeline, not this stub.
 */
export async function runMemoResearch(_entityName: string): Promise<never> {
  throw new Error(
    "runMemoResearch is not implemented — use the Buddy Intelligence Engine " +
      "pipeline (POST /api/deals/[dealId]/research/run) instead.",
  );
}