"use client";

import { useState } from "react";
import { DocHighlightModal } from "@/components/evidence/DocHighlightModal";

export function BankerDocSpanChip(props: {
  dealId: string;
  attachmentId: string;
  start: number;
  end: number;
  label: string;
}) {
  const { dealId, attachmentId, start, end, label } = props;
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
        title="Open OCR excerpt"
      >
        🔎 {label}
      </button>

      <DocHighlightModal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        loader={async () => {
          const r = await fetch(`/api/deals/${dealId}/documents/${attachmentId}/text`, { cache: "no-store" });
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error || "doc_text_failed");

          // server returned full extracted_text
          const text = String(j.doc?.extracted_text || "");
          if (!text) throw new Error("No OCR text");

          // reuse snippet logic client-side (simple)
          const left = Math.max(0, start - 140);
          const right = Math.min(text.length, end + 140);
          const snippet = text.slice(left, right);

          return {
            snippet,
            highlightStart: start - left,
            highlightEnd: end - left,
            truncated: false,
          };
        }}
      />
    </>
  );
}
