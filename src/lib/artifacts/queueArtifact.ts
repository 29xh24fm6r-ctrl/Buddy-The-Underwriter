/**
 * Queue a document for artifact processing (classification/extraction/matching).
 *
 * This is the entry point for the Magic Intake pipeline.
 * Call this after any document is inserted into deal_documents or borrower_uploads.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type QueueArtifactParams = {
  dealId: string;
  bankId: string;
  sourceTable: "deal_documents" | "borrower_uploads";
  sourceId: string;
};

export type QueueArtifactResult = {
  ok: boolean;
  artifactId?: string;
  error?: string;
  alreadyQueued?: boolean;
};

/**
 * Queue a document for AI classification and checklist matching.
 *
 * This is idempotent - calling it multiple times for the same document
 * will not create duplicate artifacts.
 */
export async function queueArtifact(
  params: QueueArtifactParams
): Promise<QueueArtifactResult> {
  const { dealId, bankId, sourceTable, sourceId } = params;

  try {
    const sb = supabaseAdmin();

    // Check if artifact already exists
    const existing = await sb
      .from("document_artifacts")
      .select("id, status")
      .eq("source_table", sourceTable)
      .eq("source_id", sourceId)
      .maybeSingle();

    if (existing.data) {
      // Already queued or processed
      return {
        ok: true,
        artifactId: existing.data.id,
        alreadyQueued: true,
      };
    }

    // Use RPC for atomic upsert with proper handling
    const result = await sb.rpc("queue_document_artifact", {
      p_deal_id: dealId,
      p_bank_id: bankId,
      p_source_table: sourceTable,
      p_source_id: sourceId,
    });

    if (result.error) {
      console.error("[queueArtifact] RPC failed", {
        dealId,
        sourceTable,
        sourceId,
        error: result.error.message,
      });
      return {
        ok: false,
        error: result.error.message,
      };
    }

    const artifactId = result.data as string;

    console.log("[queueArtifact] queued artifact", {
      dealId,
      sourceTable,
      sourceId,
      artifactId,
    });

    // B4: Dual pipeline detection — emit event if document_jobs also exist for this doc
    if (sourceTable === "deal_documents") {
      (sb as any)
        .from("document_jobs")
        .select("id", { count: "exact", head: true })
        .eq("attachment_id", sourceId)
        .then(({ count }: { count: number | null }) => {
          if (count && count > 0) {
            import("@/lib/aegis").then(({ writeSystemEvent }) =>
              writeSystemEvent({
                event_type: "warning",
                severity: "info",
                source_system: "queue_artifact",
                deal_id: dealId,
                bank_id: bankId,
                error_code: "DUAL_PIPELINE_DETECTED",
                error_message: `Document ${sourceId} has both document_artifacts and document_jobs rows`,
                payload: { sourceId, artifactId, sourceTable },
              }),
            ).catch(() => {});
          }
        })
        .catch(() => {});
    }

    return {
      ok: true,
      artifactId,
    };
  } catch (error: any) {
    console.error("[queueArtifact] unexpected error", {
      dealId,
      sourceTable,
      sourceId,
      error: error?.message,
    });
    return {
      ok: false,
      error: error?.message || "Unknown error",
    };
  }
}

/**
 * Queue multiple documents for processing.
 */
export async function queueArtifactsBatch(
  params: QueueArtifactParams[]
): Promise<QueueArtifactResult[]> {
  return Promise.all(params.map(queueArtifact));
}

/**
 * Queue all unprocessed documents for a deal.
 * This is used for backfilling existing documents.
 */
export async function backfillDealArtifacts(
  dealId: string,
  bankId: string
): Promise<{ queued: number; skipped: number; errors: number }> {
  const sb = supabaseAdmin();

  // Get all deal_documents that don't have artifacts yet
  const { data: dealDocs, error: dealDocsErr } = await sb
    .from("deal_documents")
    .select("id")
    .eq("deal_id", dealId);

  if (dealDocsErr) {
    console.error("[backfillDealArtifacts] failed to fetch deal_documents", {
      dealId,
      error: dealDocsErr.message,
    });
  }

  // Get all borrower_uploads that don't have artifacts yet
  const { data: borrowerUploads, error: borrowerErr } = await sb
    .from("borrower_uploads")
    .select("id")
    .eq("deal_id", dealId);

  if (borrowerErr) {
    console.error("[backfillDealArtifacts] failed to fetch borrower_uploads", {
      dealId,
      error: borrowerErr.message,
    });
  }

  const toQueue: QueueArtifactParams[] = [];

  for (const doc of dealDocs || []) {
    toQueue.push({
      dealId,
      bankId,
      sourceTable: "deal_documents",
      sourceId: doc.id,
    });
  }

  for (const upload of borrowerUploads || []) {
    toQueue.push({
      dealId,
      bankId,
      sourceTable: "borrower_uploads",
      sourceId: upload.id,
    });
  }

  const results = await queueArtifactsBatch(toQueue);

  const stats = {
    queued: 0,
    skipped: 0,
    errors: 0,
  };

  for (const result of results) {
    if (!result.ok) {
      stats.errors++;
    } else if (result.alreadyQueued) {
      stats.skipped++;
    } else {
      stats.queued++;
    }
  }

  console.log("[backfillDealArtifacts] completed", {
    dealId,
    ...stats,
    totalDocuments: toQueue.length,
  });

  return stats;
}
