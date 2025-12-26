\"use client\";

import { useEffect, useMemo, useState } from \"react\";
import { Document, Page } from \"react-pdf\";
import \"@/lib/pdf/pdfWorker\";
import type { PdfEvidenceSpan } from \"@/lib/evidence/pdfSpans\";
import { FocusZoomController } from \"@/components/pdf/FocusZoomController\";
import { useViewerStore } from \"@/lib/evidence/pdfViewerStore\";

type Props = {
  dealId: string;
  attachmentId: string;
};

function spanOverlayId(s: PdfEvidenceSpan) {
  return `${s.attachment_id}:${s.start}:${s.end}`;
}

export function PdfEvidenceSpansViewer(props: Props) {
  const { dealId, attachmentId } = props;

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [spans, setSpans] = useState<PdfEvidenceSpan[]>([]);
  const [numPages, setNumPages] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const focusedOverlayId = useViewerStore((s: any) => s.focusedOverlayId);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setErr(null);
        const r = await fetch(`/api/deals/${dealId}/documents/${attachmentId}/pdf-spans`, { cache: \"no-store\" });
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !j?.ok) throw new Error(j?.error || \"pdf_spans_failed\");
        setPdfUrl(String(j.pdfUrl || \"\"));
        setSpans(Array.isArray(j.evidenceSpans) ? j.evidenceSpans : []);
      } catch (e: any) {
        if (!alive) return;
        setErr(String(e?.message ?? e));
        setPdfUrl(null);
        setSpans([]);
      }
    })();
    return () => { alive = false; };
  }, [dealId, attachmentId]);

  const spansByPage = useMemo(() => {
    const m = new Map<number, PdfEvidenceSpan[]>();
    for (const s of spans) {
      const bb: any = s.bounding_box;
      if (!bb) continue;
      const page = Number(bb.page || 1);
      const arr = m.get(page) || [];
      arr.push(s);
      m.set(page, arr);
    }
    return m;
  }, [spans]);

  return (
    <div className=\"rounded-xl border border-gray-200 bg-white p-4\">
      <FocusZoomController />

      <div className=\"mb-3 flex items-start justify-between gap-3\">
        <div>
          <div className=\"text-sm font-semibold text-gray-900\">PDF Evidence Spans</div>
          <div className=\"text-xs text-gray-500\">Highlights from /pdf-spans (normalized boxes)</div>
        </div>
        <div className=\"text-xs text-gray-500\">Spans: {spans.length}</div>
      </div>

      {err ? (
        <pre className=\"mb-3 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800\">{err}</pre>
      ) : null}

      <div data-pdf-viewport=\"true\" className=\"max-h-[70vh] overflow-auto rounded-lg border border-gray-200\">
        <div data-pdf-viewport-inner=\"true\">
          {pdfUrl ? (
            <Document
              file={pdfUrl}
              onLoadSuccess={(d) => setNumPages(d.numPages)}
              loading={<div className=\"p-4 text-sm text-gray-600\">Loading PDF…</div>}
            >
              {Array.from({ length: numPages || 1 }).map((_, idx) => {
                const pageNum = idx + 1;
                const pageSpans = spansByPage.get(pageNum) || [];
                return (
                  <div key={pageNum} className=\"mb-6\">
                    <div className=\"mb-2 text-xs text-gray-600\">Page {pageNum}</div>

                    <div className=\"relative overflow-hidden rounded-lg border border-gray-200\">
                      <Page pageNumber={pageNum} width={820} />

                      {/* Overlay layer */}
                      <div className=\"pointer-events-none absolute inset-0\">
                        {pageSpans.map((s, i) => {
                          const bb: any = s.bounding_box;
                          if (!bb) return null;

                          const id = spanOverlayId(s);
                          const isFocused = focusedOverlayId && focusedOverlayId === id;

                          const left = `${Number(bb.x) * 100}%`;
                          const top = `${Number(bb.y) * 100}%`;
                          const width = `${Math.max(0.001, Number(bb.width)) * 100}%`;
                          const height = `${Math.max(0.001, Number(bb.height)) * 100}%`;

                          return (
                            <div
                              key={id}
                              data-overlay-id={i == 0 ? id : undefined}
                              className={[
                                \"absolute rounded-sm\",
                                isFocused
                                  ? \"z-50 ring-2 ring-white/80 bg-white/15 animate-pulse\"
                                  : \"z-10 bg-yellow-200/40 outline outline-1 outline-yellow-400/60\",
                              ].join(\" \")}
                              style={{ left, top, width, height }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Document>
          ) : (
            <div className=\"p-4 text-sm text-gray-600\">Loading spans…</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PdfEvidenceSpansViewer;
