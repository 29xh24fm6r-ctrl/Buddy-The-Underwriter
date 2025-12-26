"use client";

import { useState } from "react";
import { PdfEvidenceSpansViewer } from "@/components/evidence/PdfEvidenceSpansViewer";

type BankerPdfSpanChipProps = {
  dealId: string;
  attachmentId: string;
  label?: string;
};

export function BankerPdfSpanChip(props: BankerPdfSpanChipProps) {
  const { dealId, attachmentId, label } = props;
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
        title="Open PDF with evidence highlights"
      >
        📄 {label || "Open PDF evidence"}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] bg-black/80 p-4">
          <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">Evidence PDF</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <PdfEvidenceSpansViewer
                dealId={dealId}
                attachmentId={attachmentId}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
