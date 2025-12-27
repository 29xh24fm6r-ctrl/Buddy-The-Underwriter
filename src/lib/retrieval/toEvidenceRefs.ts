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
    const mapped = mapEvidenceChunkRow(c);
    const refs: EvidenceRefT[] = [];
    // Cite both start and end pages to cover full chunk range
    refs.push({
      kind: "pdf",
      sourceId: (mapped.documentId || "unknown")!,
      page: mapped.pageStart!,
      label: "Evidence",
    });
    if (mapped.pageEnd !== mapped.pageStart) {
      refs.push({
        kind: "pdf",
        sourceId: (mapped.documentId || "unknown")!,
        page: mapped.pageEnd!,
        label: "Evidence",
      });
    }
    return refs;
  });
}