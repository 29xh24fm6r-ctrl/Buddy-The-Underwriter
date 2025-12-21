"use client";

import { useMemo, useState } from "react";
import { DocHighlightModal } from "@/components/evidence/DocHighlightModal";

type PortalEvidenceEvent = {
  id: string;
  scope: string;
  action: string;
  confidence: number | null;
  evidence_json: {
    evidence_spans?: Array<{ attachment_id: string; start: number; end: number; label?: string | null; confidence?: number | null }>;
    evidence?: Array<{ kind: string; note: string }>;
  } | null;
  created_at: string;
};

export function BorrowerEvidenceWidget(props: {
  dealId: string;
  inviteToken: string; // you already have this in portal pages
}) {
  const { dealId, inviteToken } = props;

  const [events, setEvents] = useState<PortalEvidenceEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ attachment_id: string; start: number; end: number; label?: string | null } | null>(null);

  async function load() {
    const r = await fetch(`/api/portal/deals/${dealId}/evidence?scope=doc_intel&limit=5`, {
      headers: { Authorization: `Bearer ${inviteToken}` },
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    if (j?.ok) {
      setEvents(j.events || []);
      setLoaded(true);
    }
  }

  const spans = useMemo(() => {
    const out: any[] = [];
    for (const ev of events || []) {
      const arr = ev.evidence_json?.evidence_spans || [];
      for (const s of arr) {
        if (s?.attachment_id) out.push(s);
        if (out.length >= 3) break;
      }
      if (out.length >= 3) break;
    }
    return out;
  }, [events]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-gray-800">Why Buddy thinks this</div>
          <div className="text-[11px] text-gray-600">Proof from your uploaded documents (safe excerpts).</div>
        </div>
        <button
          type="button"
          onClick={() => (!loaded ? load() : null)}
          className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          {loaded ? "Loaded" : "Load"}
        </button>
      </div>

      {loaded && spans.length === 0 ? (
        <div className="mt-2 text-xs text-gray-500">No document proof highlights yet.</div>
      ) : null}

      {spans.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {spans.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setSelected(s);
                setOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-800 hover:bg-gray-100"
              title="View proof excerpt"
            >
              ✨ {s.label || "View excerpt"}
            </button>
          ))}
        </div>
      ) : null}

      <DocHighlightModal
        open={open}
        onClose={() => setOpen(false)}
        title={selected?.label || "Document excerpt"}
        loader={async () => {
          if (!selected) throw new Error("No span selected");
          const qs = new URLSearchParams();
          qs.set("start", String(selected.start || 0));
          qs.set("end", String(selected.end || 0));

          const r = await fetch(
            `/api/portal/deals/${dealId}/documents/${selected.attachment_id}/snippet?${qs.toString()}`,
            { headers: { Authorization: `Bearer ${inviteToken}` }, cache: "no-store" }
          );
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error || "snippet_failed");
          return { snippet: j.snippet, highlightStart: j.highlightStart, highlightEnd: j.highlightEnd, truncated: j.truncated };
        }}
      />
    </div>
  );
}
