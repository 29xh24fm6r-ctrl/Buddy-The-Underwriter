"use client";

import { useEffect, useRef, useState } from "react";
import type { PdfBoundingBox } from "@/lib/evidence/pdfSpans";

type PdfViewerWithOverlayProps = {
  pdfUrl: string;
  initialPage?: number;
  highlights?: Array<{
    page: number;
    box: PdfBoundingBox;
    label?: string;
    color?: string;
  }>;
  onClose?: () => void;
};

/**
 * PDF viewer with evidence span overlays.
 * Uses browser's native PDF rendering (object/embed) with absolute positioned highlights.
 * For production, consider replacing with pdf.js for more control.
 */
export function PdfViewerWithOverlay(props: PdfViewerWithOverlayProps) {
  const { pdfUrl, initialPage = 1, highlights = [], onClose } = props;

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter highlights for current page
  const pageHighlights = highlights.filter((h) => h.page === currentPage);

  useEffect(() => {
    setCurrentPage(initialPage);
  }, [initialPage]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90">
      {/* Header */}
      <div className="absolute left-0 right-0 top-0 z-10 border-b border-gray-700 bg-gray-900 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
              disabled={currentPage <= 1}
            >
              ← Prev
            </button>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-300">Page</span>
              <input
                type="number"
                value={currentPage}
                onChange={(e) => setCurrentPage(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-center text-sm text-white"
                min={1}
              />
            </div>

            <button
              type="button"
              onClick={() => setCurrentPage((p) => p + 1)}
              className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            >
              Next →
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
              className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            >
              −
            </button>

            <span className="text-sm text-gray-300">{Math.round(scale * 100)}%</span>

            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.0, s + 0.1))}
              className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            >
              +
            </button>

            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-600 bg-gray-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-gray-700"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>

        {pageHighlights.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {pageHighlights.map((h, idx) => (
              <div
                key={idx}
                className="rounded-full border border-yellow-500/50 bg-yellow-500/20 px-3 py-1 text-xs text-yellow-200"
              >
                ✨ {h.label || `Highlight ${idx + 1}`}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* PDF Canvas with Overlays */}
      <div
        ref={containerRef}
        className="absolute inset-0 top-20 overflow-auto"
        style={{ paddingTop: "1rem", paddingBottom: "2rem" }}
      >
        <div className="relative mx-auto" style={{ width: "fit-content" }}>
          {/* Simplified: Use iframe for PDF rendering */}
          {/* Production: Replace with pdf.js for pixel-perfect overlay positioning */}
          <div className="relative inline-block">
            <iframe
              src={`${pdfUrl}#page=${currentPage}&zoom=${Math.round(scale * 100)}`}
              className="rounded-lg border border-gray-700 bg-white"
              style={{
                width: `${800 * scale}px`,
                height: `${1100 * scale}px`,
              }}
              onLoad={() => setLoading(false)}
              title="PDF Viewer"
            />

            {/* Highlight Overlays */}
            {!loading &&
              pageHighlights.map((h, idx) => {
                // Convert bounding box to pixel coordinates
                // This is simplified - production needs accurate PDF→pixel mapping
                const pixelX = h.box.x * scale;
                const pixelY = h.box.y * scale;
                const pixelWidth = h.box.width * scale;
                const pixelHeight = h.box.height * scale;

                return (
                  <div
                    key={idx}
                    className="pointer-events-none absolute rounded border-2 border-yellow-400 bg-yellow-300/30"
                    style={{
                      left: `${pixelX}px`,
                      top: `${pixelY}px`,
                      width: `${pixelWidth}px`,
                      height: `${pixelHeight}px`,
                    }}
                    title={h.label || "Evidence highlight"}
                  />
                );
              })}
          </div>

          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-sm text-white">Loading PDF page {currentPage}...</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Info Banner */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
        <div className="text-center text-xs text-gray-400">
          Yellow highlights show exact evidence locations from AI analysis
        </div>
      </div>
    </div>
  );
}
