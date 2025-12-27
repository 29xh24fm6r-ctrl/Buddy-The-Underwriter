"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";

const SECTIONS = ["summary", "risks", "mitigants", "cash_flow", "collateral", "structure", "covenants"];

export default function DealMemoPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = useMemo(() => String(params?.dealId || ""), [params]);

  const [section, setSection] = useState("risks");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [citations, setCitations] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setErr(null);
    setContent(null);
    setCitations([]);
    try {
      const res = await fetch(`/api/deals/${dealId}/memo/section`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section_key: section, prompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setContent(json.content);
      setCitations(json.citations || []);
    } catch (e: any) {
      setErr(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Memo Generator</h1>

      <div className="flex gap-2 flex-wrap">
        {SECTIONS.map((s) => (
          <button
            key={s}
            className={`px-3 py-1 rounded-md text-sm border ${section === s ? "bg-black text-white" : ""}`}
            onClick={() => setSection(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <textarea
        className="w-full h-24 border rounded-md p-3 text-sm"
        placeholder="Optional: add constraints (tone, format, specific focus)..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <button
        className="px-4 py-2 rounded-md bg-black text-white text-sm disabled:opacity-50"
        disabled={loading}
        onClick={generate}
      >
        {loading ? "Generating…" : "Generate section"}
      </button>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      {content ? (
        <div className="space-y-3">
          <div className="border rounded-md p-4">
            <div className="text-sm whitespace-pre-wrap">{content}</div>
          </div>

          <div className="border rounded-md p-4 space-y-2">
            <div className="font-medium text-sm">Citations</div>
            {(citations || []).map((c, i) => (
              <a
                key={c.chunk_id + i}
                className="block text-sm border rounded-md p-3 hover:bg-gray-50"
                href={`/deals/${dealId}/evidence?upload_id=${encodeURIComponent(c.upload_id || "")}&chunk_id=${encodeURIComponent(c.chunk_id)}`}
              >
                <div className="font-mono text-[11px] opacity-70">
                  chunk_id={c.chunk_id} · upload_id={c.upload_id}
                  {c.page_number ? ` · page=${c.page_number}` : ""}
                </div>
                <div className="mt-1">{c.snippet}</div>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
