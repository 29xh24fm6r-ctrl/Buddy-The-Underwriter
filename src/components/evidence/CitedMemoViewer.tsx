"use client";

import { useEffect, useMemo, useState } from "react";
import { DocHighlightModal } from "@/components/evidence/DocHighlightModal";

type Memo = { id: string; title: string; body_md: string };
type Citation = {
  id: string;
  block_id: string;
  attachment_id: string;
  page_number: number | null;
  global_char_start: number | null;
  global_char_end: number | null;
  label: string | null;
};

function splitBlocks(md: string) {
  // v1: split on blank lines into paragraph blocks
  const parts = (md || "").split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
  return parts.map((p, i) => ({ block_id: `b${i + 1}`, text: p }));
}

export function CitedMemoViewer(props: {
  dealId: string;
  memo: Memo;
  attachmentId: string; // primary attachment for excerpt slicing
}) {
  const { dealId, memo, attachmentId } = props;

  const [citations, setCitations] = useState<Citation[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ start: number; end: number; label: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`/api/deals/${dealId}/credit-memo/${memo.id}/citations`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!alive) return;
      setCitations((j?.ok && j.citations) ? j.citations : []);
    })();
    return () => { alive = false; };
  }, [dealId, memo.id]);

  const blocks = useMemo(() => splitBlocks(memo.body_md), [memo.body_md]);

  const byBlock = useMemo(() => {
    const m = new Map<string, Citation[]>();
    for (const c of citations) {
      const arr = m.get(c.block_id) || [];
      arr.push(c);
      m.set(c.block_id, arr);
    }
    return m;
  }, [citations]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-gray-900">{memo.title}</div>
        <div className="text-xs text-gray-500">Click citations to open highlighted excerpts.</div>
      </div>

      <div className="space-y-4">
        {blocks.map((b) => {
          const cits = byBlock.get(b.block_id) || [];
          return (
            <div key={b.block_id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-[13px] text-gray-900 whitespace-pre-wrap">{b.text}</div>

              {cits.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {cits.slice(0, 8).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelected({
                          start: Number(c.global_char_start || 0),
                          end: Number(c.global_char_end || 0),
                          label: c.label || `Citation (${b.block_id})`,
                        });
                        setOpen(true);
                      }}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                      title={c.label || ""}
                    >
                      🔗 {c.label || "Source"}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-gray-500 italic">No citations for this block yet.</div>
              )}
            </div>
          );
        })}
      </div>

      <DocHighlightModal
        open={open}
        onClose={() => setOpen(false)}
        title={selected?.label || "Evidence excerpt"}
        loader={async () => {
          if (!selected) throw new Error("No citation selected");
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
