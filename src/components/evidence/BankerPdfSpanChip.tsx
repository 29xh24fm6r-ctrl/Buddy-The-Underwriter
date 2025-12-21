"use client";

import { useState } from "react";
import { PdfViewerWithOverlay } from "@/components/evidence/PdfViewerWithOverlay";
import type { PdfBoundingBox } from "@/lib/evidence/pdfSpans";

type BankerPdfSpanChipProps = {
  dealId: string;
  attachmentId: string;
  spans: Array<{
    start: number;
    end: number;
    label: string;
    confidence?: number | null;
    bounding_box?: PdfBoundingBox | null;
  }>;
  label: string;
};

/**
 * Banker PDF Span Chip — Opens PDF viewer with evidence highlights.
 * Upgraded from simple text snippet to full PDF overlay viewer.
 */
export function BankerPdfSpanChip(props: BankerPdfSpanChipProps) {
  const { dealId, attachmentId, spans, label } = props;
  const [open, setOpen] = useState(false);
  const [pdfData, setPdfData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/deals/${dealId}/documents/${attachmentId}/pdf-spans`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load PDF data");
      }

      setPdfData(json);
      setOpen(true);
    } catch (e: any) {
      setError(e?.message || "Failed to load PDF");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        title="Open PDF with evidence highlights"
      >
        📄 {label}
        {loading ? " (Loading...)" : ""}
      </button>

      {error ? (
        <div className="mt-2 text-xs text-red-600">{error}</div>
      ) : null}

      {open && pdfData?.pdfUrl ? (
        <PdfViewerWithOverlay
          pdfUrl={pdfData.pdfUrl}
          initialPage={spans[0]?.bounding_box?.page || 1}
          highlights={spans
            .filter((s) => s.bounding_box)
            .map((s) => ({
              page: s.bounding_box!.page,
              box: s.bounding_box!,
              label: s.label,
              color: "#fbbf24", // yellow
            }))}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
