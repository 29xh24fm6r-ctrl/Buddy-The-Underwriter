export type EvidenceRef = {
  kind: "pdf" | "text" | "table";
  sourceId: string;            // e.g., document id or storage path key
  label?: string;              // e.g., "Bank Statements — Aug 2025"
  page?: number;               // 1-based page number for display
  bbox?: { x: number; y: number; w: number; h: number }; // normalized 0..1
  spanIds?: string[];          // if you already produce extracted spans
  excerpt?: string;            // short quote/snippet (NOT long)
};

export function evidenceChip(e: EvidenceRef) {
  const page = e.page ? `p.${e.page}` : "";
  return `${e.label ?? e.sourceId}${page ? ` · ${page}` : ""}`;
}
