import type { EvidenceRefT } from "@/lib/ai/schemas";
import type { RetrievedChunk } from "./types";
import { mapEvidenceChunkRow } from "@/lib/db/rowCase";

/**
 * Convert retrieved chunks to EvidenceRef citations
 * These are used to constrain AI citations (no hallucinated references)
 * @param chunks - Retrieved chunks
 * @returns Array of EvidenceRef objects with page-level citations
 */
export function chunksToEvidenceRefs(args: {
  dealId: string;
  chunks: RetrievedChunk[];
}): EvidenceRefT[] {
  return args.chunks.flatMap((c) => {
    const refs: EvidenceRefT[] = [];
    // Cite both start and end pages to cover full chunk range
    refs.push({
      kind: "pdf",
      sourceId: c.documentId ?? c.document_id, // TODO: map to real source_id from evidence_documents
      page: c.pageStart ?? c.page_start,
      label: "Evidence",
    });
    if (c.pageEnd ?? c.page_end !== c.pageStart ?? c.page_start) {
      refs.push({
        kind: "pdf",
        sourceId: c.documentId ?? c.document_id,
        page: c.pageEnd ?? c.page_end,
        label: "Evidence",
      });
    }
    return refs;
  });
}