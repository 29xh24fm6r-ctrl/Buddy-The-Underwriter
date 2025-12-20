"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

interface PolicyChunk {
  id: string;
  asset_id: string;
  chunk_index: number;
  text: string;
  page_start: number;
  page_end: number;
  section_title: string | null;
  created_at: string;
  bank_assets: {
    id: string;
    title: string;
    kind: string;
  };
}

export default function PolicyChunksPage() {
  const searchParams = useSearchParams();
  const assetId = searchParams.get("asset_id");

  const [chunks, setChunks] = useState<PolicyChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadChunks();
  }, [assetId]);

  async function loadChunks() {
    try {
      setLoading(true);
      const url = assetId
        ? `/api/banks/policy/chunks?asset_id=${assetId}`
        : "/api/banks/policy/chunks";
      
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setChunks(json.chunks || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const filteredChunks = searchQuery
    ? chunks.filter((c) =>
        c.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.section_title?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : chunks;

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-muted-foreground">Loading chunks...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  const assetTitle = chunks[0]?.bank_assets.title || "All Documents";

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Policy Chunks</h1>
          <p className="text-muted-foreground mt-1">{assetTitle}</p>
        </div>
        <a
          href="/banks/settings/policy-ingestion"
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          ← Back to Ingestion
        </a>
      </div>

      {/* Search */}
      <div className="flex gap-4 items-center">
        <input
          type="text"
          placeholder="Search chunks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-lg"
        />
        <div className="text-sm text-gray-500">
          {filteredChunks.length} of {chunks.length} chunks
        </div>
      </div>

      {/* Chunks list */}
      <div className="space-y-4">
        {filteredChunks.length === 0 ? (
          <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-12 text-center text-gray-400">
            {searchQuery ? "No chunks match your search" : "No chunks found"}
          </div>
        ) : (
          filteredChunks.map((chunk) => (
            <div
              key={chunk.id}
              className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                    {chunk.chunk_index}
                  </span>
                  {chunk.section_title && (
                    <span className="font-medium text-gray-900">
                      {chunk.section_title}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  Pages {chunk.page_start}–{chunk.page_end}
                </span>
              </div>
              <div className="text-sm text-gray-700 leading-relaxed pl-11">
                {chunk.text.length > 500
                  ? chunk.text.substring(0, 500) + "..."
                  : chunk.text}
              </div>
              <div className="flex items-center gap-2 mt-3 pl-11">
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600">
                  {chunk.bank_assets.title}
                </span>
                <span className="text-xs text-gray-400">
                  • {new Date(chunk.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
