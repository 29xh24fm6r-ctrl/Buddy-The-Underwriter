import type { EvidenceRefT } from "@/lib/ai/schemas";
import type { RetrievedChunk } from "./retrieve";

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
      sourceId: c.documentId, // TODO: map to real source_id from evidence_documents
      page: c.pageStart,
      label: "Evidence",
    });
    if (c.pageEnd !== c.pageStart) {
      refs.push({
        kind: "pdf",
        sourceId: c.documentId,
        page: c.pageEnd,
        label: "Evidence",
      });
    }
    return refs;
  });
}
