"use client";

import { useEffect, useMemo, useState } from "react";
import { Document, Page } from "react-pdf";
import "@/lib/pdf/pdfWorker";
import { DocHighlightModal } from "@/components/evidence/DocHighlightModal";
import { useViewerStore } from "@/lib/evidence/pdfViewerStore";
import { FocusZoomController } from "@/components/pdf/FocusZoomController";

type Overlay = {
  citation_id: string;
  block_id: string;
  attachment_id: string;
  page_number: number;
  label: string | null;
  global_char_start?: number;
  global_char_end?: number;
  boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>;
};

export function PdfOverlayViewer(props: {
  dealId: string;
  memoId: string;
  pdfUrl: string;
  attachmentId: string;
}) {
  const { dealId, memoId, pdfUrl, attachmentId } = props;

  const [numPages, setNumPages] = useState<number>(0);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ start: number; end: number; label: string } | null>(null);
  
  // Connect to viewer store for deep-linking support
  const focusedOverlayId = useViewerStore((s: any) => s.focusedOverlayId);

  useEffect(() => {
    let alive = true;

    (async () => {
      const r = await fetch(`/api/deals/${dealId}/credit-memo/${memoId}/geometry`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!alive) return;
      setOverlays((j?.ok && j.overlays) ? j.overlays : []);
    })();

    return () => { alive = false; };
  }, [dealId, memoId]);

  const overlaysByPage = useMemo(() => {
    const map = new Map<number, Overlay[]>();
    for (const o of overlays) {
      const arr = map.get(o.page_number) || [];
      arr.push(o);
      map.set(o.page_number, arr);
    }
    return map;
  }, [overlays]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <FocusZoomController />
      
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">PDF Geometry Overlay</div>
          <div className="text-xs text-gray-500">True highlight rectangles mapped from OCR geometry.</div>
        </div>
        <div className="text-xs text-gray-500">Overlays: {overlays.length}</div>
      </div>

      <div
        data-pdf-viewport="true"
        className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200"
      >
        <div data-pdf-viewport-inner="true">
          <Document
            file={pdfUrl}
            onLoadSuccess={(d) => setNumPages(d.numPages)}
            loading={<div className="text-sm text-gray-600">Loading PDF…</div>}
          >
        {Array.from({ length: numPages || 1 }).map((_, idx) => {
          const pageNum = idx + 1;
          const pageOverlays = overlaysByPage.get(pageNum) || [];

          return (
            <div key={pageNum} className="mb-6">
              <div className="text-xs text-gray-600 mb-2">Page {pageNum}</div>

              <div className="relative rounded-lg border border-gray-200 overflow-hidden">
                <Page pageNumber={pageNum} width={820} />

                {/* Overlay layer */}
                <div className="pointer-events-none absolute inset-0">
                  {pageOverlays.map((o) => {
                    const isFocused = focusedOverlayId && 
                                     (o.citation_id === focusedOverlayId || 
                                      o.block_id === focusedOverlayId);
                    
                    return o.boxes.map((b, i) => {
                      const left = `${b.x1 * 100}%`;
                      const top = `${b.y1 * 100}%`;
                      const width = `${Math.max(0.001, (b.x2 - b.x1)) * 100}%`;
                      const height = `${Math.max(0.001, (b.y2 - b.y1)) * 100}%`;

                      return (
                        <div
                          key={`${o.citation_id}-${i}`}
                          data-overlay-id={i === 0 ? o.citation_id : undefined}
                          className={[
                            "absolute rounded-sm",
                            isFocused 
                              ? "z-50 ring-2 ring-white/80 bg-white/15 animate-pulse" 
                              : "z-10 bg-yellow-200/40 outline outline-1 outline-yellow-400/60"
                          ].join(" ")}
                          style={{ left, top, width, height }}
                        />
                      );
                    });
                  })}
                </div>

                {/* Click targets (optional): make overlays clickable */}
                <div className="absolute inset-0">
                  {pageOverlays.map((o) => {
                    // Create a small clickable badge near first box
                    const first = o.boxes[0];
                    if (!first) return null;
                    
                    const hasExcerpt = typeof o.global_char_start === "number" && typeof o.global_char_end === "number";
                    
                    return (
                      <button
                        key={`${o.citation_id}-badge`}
                        type="button"
                        onClick={() => {
                          if (hasExcerpt) {
                            setSelected({ 
                              start: o.global_char_start!, 
                              end: o.global_char_end!, 
                              label: o.label || `Citation ${o.block_id}` 
                            });
                            setOpen(true);
                          }
                        }}
                        className={`absolute pointer-events-auto rounded-full border border-gray-200 px-2 py-1 text-[11px] text-gray-800 shadow ${
                          hasExcerpt 
                            ? "bg-white/90 hover:bg-white hover:shadow-md cursor-pointer" 
                            : "bg-gray-100/70 cursor-default"
                        }`}
                        style={{
                          left: `${first.x1 * 100}%`,
                          top: `${Math.max(0, first.y1 * 100 - 2)}%`,
                          transform: "translateY(-100%)",
                        }}
                        title={hasExcerpt ? `Click to open excerpt: ${o.label || "citation"}` : "No excerpt available"}
                      >
                        📌 {o.label || o.block_id}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </Document>
        </div>
      </div>

      <DocHighlightModal
        open={open}
        onClose={() => setOpen(false)}
        title={selected?.label || "Citation"}
        loader={async () => {
          if (!selected || selected.start === 0 && selected.end === 0) {
            return {
              snippet: "No excerpt available for this overlay.",
              highlightStart: 0,
              highlightEnd: 0,
              truncated: false,
            };
          }

          // Fetch full OCR text and slice excerpt for banker (internal)
          const r = await fetch(`/api/deals/${dealId}/documents/${attachmentId}/text`, { cache: "no-store" });
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error || "doc_text_failed");
          
          const text = String(j.doc?.extracted_text || "");
          const left = Math.max(0, selected.start - 160);
          const right = Math.min(text.length, selected.end + 160);
          const snippet = text.slice(left, right);

          return {
            snippet,
            highlightStart: Math.max(0, selected.start - left),
            highlightEnd: Math.max(0, selected.end - left),
            truncated: false,
          };
        }}
      />
    </div>
  );
}
