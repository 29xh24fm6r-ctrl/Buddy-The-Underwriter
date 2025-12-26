"use client";

import { useEffect, useMemo, useState } from "react";
import { Document, Page } from "react-pdf";
import "@/lib/pdf/pdfWorker";
import { FocusZoomController } from "@/components/pdf/FocusZoomController";
import { useViewerStore } from "@/lib/evidence/pdfViewerStore";

type ApiResp = {
  ok: boolean;
  pdfUrl: string | null;
  evidenceSpans: Array<{
    attachment_id: string;
    start: number;
    end: number;
    label?: string | null;
    confidence?: number | null;
    bounding_box?: {
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      coordinate_system?: "top-left" | "bottom-left";
    } | null;
  }>;
};

export function PdfEvidenceSpansViewer(props: { dealId: string; attachmentId: string; }) {
  const { dealId, attachmentId } = props;

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [spans, setSpans] = useState<ApiResp["evidenceSpans"]>([]);
  const focusedOverlayId = useViewerStore((s: any) => s.focusedOverlayId);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`/api/deals/${dealId}/documents/${attachmentId}/pdf-spans`, { cache: "no-store" });
      const j = (await r.json()).catch(() => null) as ApiResp | null;
      if (!alive) return;
      if (!r.ok || !j ?.ok) {
        setPdfUrl(null);
        setSpans([]);
        return;
      }
      setPdfUrl(j.pdfUrl);
      setSpans(Array.isArray(j.evidenceSpans) ? j.evidenceSpans : []);
    })();
    return () => { alive = false; };
  }, [dealId, attachmentId]);

  const spansByPage = useMemo(() => {
    const m = new Map<number, ApiResp["evidenceSpans"]>();
    for (const s of spans) {
      const bb = s.bounding_box;
      if (!bb) continue;
      const p = Number(bb.page);
      const arr = m.get(p) || [];
      arr.push(s);
      m.set(p, arr);
    }
    return m;
  }, [spans]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <FocusZoomController />
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">PDF Evidence Spans</div>
          <div className="text-xs text-gray-500">True rectangle overlays from /pdf-spans</div>
        </div>
        <div className="text-xs text-gray-500">Spans: {spans.length}</div>
      </div>

      <div data-pdf-viewport="true" className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200">
        <div data-pdf-viewport-inner="true">
          {pdfUrl ? (
            <Document file={pdfUrl} onLoadSuccess={(d) => setNumPages(d.numPages)} loading={<div className="text-sm text-gray-600">Loading PDF...</div>}>
             {Array.from({ length: numPages || 1 }).map((_, idx) => {
              const pageNum = idx + 1;
              const pageSpans = spansByPage.get(pageNum) || [];
              return (
                <div key={pageNum} className="mb-6">
                  <div className="text-xs text-gray-600 mb-2">Page {pageNum}</div>
                  <div className="relative rounded-lg border border-gray-200 overflow-hidden">
                    <Page pageNumber={pageNum} width={820} />
                    <div className="pointer-events-none absolute inset-0">
                      {pageSpans.map((s, i) => {
                        const bb = s.bounding_box;
                        if (!bb) return null;

                        const x = Number(bb.x);
                        const y = Number(bb.y);
                        const w0 = Number(bb.width);
                        const h0 = Number(bb.height);

                        const topNorm = bb.coordinate_system === "bottom-left" ? (1 - y - h0) : y;

                        const left = `${x * 100}%`;
                        const top = `${topNorm * 100}%`;
                        const width = `${Math.max(0.001, w0) * 100}%`;
                        const height = `${Math.max(0.001, h0) * 100}%`;

                        const isFocused = focusedOverlayId == String((s as any).span_id ?? i);
                        const dataId = String((s as any).span_id ?? i);

                        return (
                          <div
                            key={dataId + "-" + i}
                            data-overlay-id={dataId}
                            className={[
                              "absolute rounded-sm",
                                isFocused
                                  ? "z-50 ring-2 ring-white/80 bg-white/15 animate-pulse"
                                  : "z-10 bg-yellow-200/40 outline outline-1 outline-yellow-400/60",
                            ].join(" ")}
                            style={{ left, top, width, height }}
                          />
                        );
                        })}
                    </div>
                  </div>
                </div>
              ); })}
            </Document>
          ) : (
            <div className="text-sm text-gray-600 p-4">Loading spans...</div>
          )
        }
        </div>
      </div>
    </div>
  );
}

export default PdfEvidenceSpansViewer;
