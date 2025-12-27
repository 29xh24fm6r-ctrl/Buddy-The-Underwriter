"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";

type Citation = {
  chunk_id: string;
  upload_id: string;
  page_start?: number | null;
  page_end?: number | null;
  snippet: string;
  similarity?: number;
};

type CommitteeAnswer = {
  answer: string;
  citations: Citation[];
  debug?: any;
};

export default function DealCommitteePage() {
  const params = useParams<{ dealId: string }>();
  const dealId = useMemo(() => String(params?.dealId || ""), [params]);

  const [question, setQuestion] = useState("What are the biggest risks in this deal, and what evidence supports them?");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommitteeAnswer | null>(null);
  const [debug, setDebug] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/committee`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, debug }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setResult(json);
    } catch (e: any) {
      setErr(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Committee Q&A</h1>
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
          debug
        </label>
      </div>

      <div className="space-y-2">
        <textarea
          className="w-full h-28 border rounded-md p-3 text-sm"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          className="px-4 py-2 rounded-md bg-black text-white text-sm disabled:opacity-50"
          disabled={loading}
          onClick={run}
        >
          {loading ? "Thinking…" : "Ask Committee"}
        </button>
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>

      {result ? (
        <div className="space-y-4">
          <div className="border rounded-md p-4">
            <div className="text-sm whitespace-pre-wrap">{result.answer}</div>
          </div>

          <div className="border rounded-md p-4 space-y-2">
            <div className="font-medium text-sm">Citations</div>
            {result.citations?.length ? (
              <div className="space-y-2">
                {result.citations.map((c, i) => (
                  <a
                    key={c.chunk_id + i}
                    className="block text-sm border rounded-md p-3 hover:bg-gray-50"
                    href={`/deals/${dealId}/evidence?upload_id=${encodeURIComponent(c.upload_id)}&chunk_id=${encodeURIComponent(c.chunk_id)}`}
                  >
                    <div className="font-mono text-[11px] opacity-70">
                      upload_id={c.upload_id} · chunk_id={c.chunk_id}
                      {typeof c.similarity === "number" ? ` · sim=${c.similarity.toFixed(3)}` : ""}
                    </div>
                    <div className="mt-1">{c.snippet}</div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-sm opacity-70">No citations returned.</div>
            )}
          </div>

          {debug && result.debug ? (
            <pre className="text-xs border rounded-md p-3 overflow-auto max-h-[420px]">
              {JSON.stringify(result.debug, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
