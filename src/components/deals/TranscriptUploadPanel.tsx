"use client";

import { useState } from "react";

type Candidate = {
  fact_type: string;
  fact_key: string;
  value: string | number;
  confidence: number;
  snippet: string;
  owner_name?: string;
};

export default function TranscriptUploadPanel({ dealId }: { dealId: string }) {
  const [text, setText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Otter.ai");
  const [uploading, setUploading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());

  const upload = async () => {
    if (!text.trim()) return;
    setUploading(true);
    setCandidates([]);
    try {
      const res = await fetch(`/api/deals/${dealId}/transcript-ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_text: text, source_label: sourceLabel }),
      });
      const data = await res.json();
      if (data.ok) {
        setCandidates(data.candidates);
        setUploadId(data.upload_id);
      }
    } finally {
      setUploading(false);
    }
  };

  const confirmCandidate = async (idx: number, candidate: Candidate) => {
    setConfirming(prev => new Set(prev).add(idx));
    await fetch(`/api/deals/${dealId}/gap-queue/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "provide_value",
        gapId: "transcript-" + idx,
        factType: candidate.fact_type,
        factKey: candidate.fact_key,
        value: candidate.value,
      }),
    });
    setConfirmed(prev => new Set(prev).add(idx));
    setConfirming(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  const SOURCE_LABELS = ["Otter.ai", "Fireflies", "Fathom", "Teams recording", "Manual notes", "Other"];

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Upload Call Notes / Transcript</div>
        <div className="text-xs text-gray-400 mt-0.5">Buddy extracts verifiable facts — no subjective content is stored</div>
      </div>

      {candidates.length === 0 ? (
        <div className="p-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            {SOURCE_LABELS.map(label => (
              <button
                key={label}
                onClick={() => setSourceLabel(label)}
                className={`text-xs px-2.5 py-1 rounded border ${
                  sourceLabel === label
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            rows={8}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste your Otter.ai transcript, Fireflies notes, or meeting summary here..."
            className="w-full text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
          />
          <button
            onClick={upload}
            disabled={uploading || !text.trim()}
            className="text-xs font-semibold bg-gray-900 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:bg-gray-300"
          >
            {uploading ? "Extracting facts..." : "Extract Facts"}
          </button>
        </div>
      ) : (
        <div>
          <div className="px-4 py-2 bg-sky-50 border-b border-sky-100 text-xs text-sky-700">
            Found {candidates.length} verifiable facts. Confirm the ones that are correct.
          </div>
          <div className="divide-y divide-gray-100">
            {candidates.map((c, i) => (
              <div key={i} className={`px-4 py-3 flex items-start gap-3 ${confirmed.has(i) ? "bg-emerald-50" : ""}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono font-semibold text-gray-700">{c.fact_key}</span>
                    <span className="text-xs text-gray-400">{Math.round(c.confidence * 100)}% confident</span>
                  </div>
                  <div className="text-sm text-gray-900 font-medium">{String(c.value)}</div>
                  {c.snippet && (
                    <div className="text-xs text-gray-400 mt-0.5 italic">&quot;{c.snippet.slice(0, 120)}&quot;</div>
                  )}
                </div>
                {confirmed.has(i) ? (
                  <span className="text-xs text-emerald-600 font-semibold">Confirmed</span>
                ) : (
                  <button
                    onClick={() => confirmCandidate(i, c)}
                    disabled={confirming.has(i)}
                    className="flex-shrink-0 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded"
                  >
                    {confirming.has(i) ? "..." : "Confirm"}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              onClick={() => { setCandidates([]); setText(""); setConfirmed(new Set()); }}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Upload another transcript
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
