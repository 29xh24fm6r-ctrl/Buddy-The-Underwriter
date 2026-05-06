// Server-only self-heal layer for the banker flow.
//
// Goal: when readiness is computed and a recoverable prerequisite is
// missing, run the cheap fix automatically. Heavier jobs (research mission,
// spread recompute) are NOT auto-enqueued — those are surfaced as recovery
// blockers so the banker explicitly clicks to start them.
//
// Cheap auto-fixes (run inline):
//   • Collateral extraction — projects already-extracted document facts
//     into deal_collateral_items. Pure projection, no LLM.
//   • Memo input prefill (warm-up) — read-only; no DB writes.
//
// Heavy jobs (surfaced as blockers):
//   • Research mission start
//   • Financial spread recompute
//   • Stuck-document recovery
//
// Self-heal is fire-and-forget from the caller's perspective. Failures
// are logged, never thrown.

import "server-only";

import { extractCollateralFromDocuments } from "@/lib/creditMemo/inputs/extractCollateralFromDocuments";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type SelfHealReport = {
  dealId: string;
  collateralExtraction:
    | { ran: false; reason: string }
    | { ran: true; itemsUpserted: number; itemsFlaggedForReview: number };
  detected: {
    documentsProcessingStalled: boolean;
    researchMissing: boolean;
    financialSnapshotStale: boolean;
    collateralExtractionNeeded: boolean;
    memoPrefillStale: boolean;
  };
  startedAt: string;
  completedAt: string;
};

const STALE_SNAPSHOT_THRESHOLD_HOURS = 24;
const PROCESSING_STALL_THRESHOLD_MINUTES = 30;

export async function selfHealDeal(args: {
  dealId: string;
}): Promise<SelfHealReport> {
  const startedAt = new Date().toISOString();
  const sb = supabaseAdmin();

  const detected = {
    documentsProcessingStalled: false,
    researchMissing: false,
    financialSnapshotStale: false,
    collateralExtractionNeeded: false,
    memoPrefillStale: false,
  };

  // ── Detection pass — read-only, used to decide which fix to run ────────
  const [
    stuckDocsCount,
    researchMissingFlag,
    snapshotAge,
    collateralCount,
    collateralDocsCount,
  ] = await Promise.all([
    countStuckDocuments(sb, args.dealId),
    isResearchMissing(sb, args.dealId),
    loadSnapshotAgeHours(sb, args.dealId),
    countCollateralRows(sb, args.dealId),
    countCollateralDocs(sb, args.dealId),
  ]);

  detected.documentsProcessingStalled = stuckDocsCount > 0;
  detected.researchMissing = researchMissingFlag;
  detected.financialSnapshotStale =
    snapshotAge !== null && snapshotAge > STALE_SNAPSHOT_THRESHOLD_HOURS;
  detected.collateralExtractionNeeded =
    collateralCount === 0 && collateralDocsCount > 0;
  detected.memoPrefillStale = false; // Always false — prefill is computed on-demand.

  // ── Auto-fix pass — only the cheap, deterministic ones ────────────────
  let collateralExtraction: SelfHealReport["collateralExtraction"] = {
    ran: false,
    reason: "not_needed",
  };

  if (detected.collateralExtractionNeeded) {
    try {
      const result = await extractCollateralFromDocuments({
        dealId: args.dealId,
      });
      if (result.ok) {
        collateralExtraction = {
          ran: true,
          itemsUpserted: result.itemsUpserted,
          itemsFlaggedForReview: result.itemsFlaggedForReview,
        };
      } else {
        collateralExtraction = {
          ran: false,
          reason: result.reason,
        };
      }
    } catch (e) {
      collateralExtraction = {
        ran: false,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return {
    dealId: args.dealId,
    collateralExtraction,
    detected,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

// ─── Detection queries ───────────────────────────────────────────────────────

async function countStuckDocuments(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<number> {
  const cutoff = new Date(
    Date.now() - PROCESSING_STALL_THRESHOLD_MINUTES * 60 * 1000,
  ).toISOString();
  try {
    const { count } = await (sb as any)
      .from("document_artifacts")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .in("status", ["queued", "processing"])
      .lt("updated_at", cutoff);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function isResearchMissing(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<boolean> {
  try {
    const { count } = await (sb as any)
      .from("buddy_research_missions")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "complete");
    return (count ?? 0) === 0;
  } catch {
    return true;
  }
}

async function loadSnapshotAgeHours(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<number | null> {
  try {
    const { data } = await (sb as any)
      .from("deal_financial_snapshots")
      .select("created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const created = new Date((data as any).created_at).getTime();
    if (!Number.isFinite(created)) return null;
    return (Date.now() - created) / (60 * 60 * 1000);
  } catch {
    return null;
  }
}

async function countCollateralRows(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<number> {
  try {
    const { count } = await (sb as any)
      .from("deal_collateral_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function countCollateralDocs(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<number> {
  try {
    const { data } = await (sb as any)
      .from("deal_documents")
      .select("canonical_type, document_type")
      .eq("deal_id", dealId);
    if (!data) return 0;
    let count = 0;
    for (const d of data as any[]) {
      const c = String(d.canonical_type ?? d.document_type ?? "").toUpperCase();
      if (
        c.includes("APPRAISAL") ||
        c.includes("UCC") ||
        c.includes("PURCHASE") ||
        c.includes("EQUIPMENT") ||
        c.includes("INSURANCE") ||
        c.includes("TITLE")
      ) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}
