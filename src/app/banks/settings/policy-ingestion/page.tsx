"use client";

import { useState, useEffect } from "react";

interface BankAsset {
  id: string;
  title: string;
  kind: string;
  storage_path: string;
  created_at: string;
}

interface ChunkStats {
  asset_id: string;
  chunk_count: number;
  asset_title: string;
}

export default function PolicyIngestionPage() {
  const [assets, setAssets] = useState<BankAsset[]>([]);
  const [chunkStats, setChunkStats] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAssets();
    loadChunkStats();
  }, []);

  async function loadAssets() {
    try {
      setLoading(true);
      const res = await fetch("/api/banks/assets/list");
      if (res.status === 401) {
        window.location.href = "/sign-in";
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAssets(json.items || []);
    } catch (err: any) {
      setError("Failed to load documents. Please try refreshing the page.");
    } finally {
      setLoading(false);
    }
  }

  async function loadChunkStats() {
    try {
      const res = await fetch("/api/banks/policy/chunks");
      if (res.status === 401) {
        window.location.href = "/sign-in";
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      // Count chunks per asset
      const stats = new Map<string, number>();
      for (const chunk of json.chunks || []) {
        const count = stats.get(chunk.asset_id) || 0;
        stats.set(chunk.asset_id, count + 1);
      }
      setChunkStats(stats);
    } catch (err: any) {
      console.error("Failed to load chunk stats:", err);
    }
  }

  async function handleIngest(assetId: string) {
    try {
      setProcessing(assetId);
      setError(null);

      const res = await fetch("/api/banks/policy/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: assetId,
          chunk_size: 500,
          overlap: 50,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = "/sign-in";
          return;
        }
        const json = await res.json();
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      alert(`Created ${json.chunks_created} chunks`);

      // Reload stats
      await loadChunkStats();
    } catch (err: any) {
      setError("Ingestion failed. Please try again.");
    } finally {
      setProcessing(null);
    }
  }

  async function handleDeleteChunks(assetId: string) {
    if (!confirm("Delete all chunks for this document? This cannot be undone.")) {
      return;
    }

    try {
      setProcessing(assetId);
      setError(null);

      const res = await fetch(`/api/banks/policy/chunks?asset_id=${assetId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = "/sign-in";
          return;
        }
        const json = await res.json();
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      alert(`Deleted ${json.deleted} chunks`);

      // Reload stats
      await loadChunkStats();
    } catch (err: any) {
      setError("Failed to delete chunks. Please try again.");
    } finally {
      setProcessing(null);
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Policy Ingestion</h1>
          <p className="text-muted-foreground mt-1">
            Extract text from policy PDFs and create searchable chunks
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex gap-3">
          <div className="text-blue-600 text-xl">ℹ️</div>
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-1">How it works:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Upload policy PDFs in <a href="/banks/settings/documents" className="underline">Bank Knowledge Vault</a></li>
              <li>Click "Ingest" to extract text and create chunks</li>
              <li>Chunks are used for policy citations in underwriting decisions</li>
              <li>Re-ingest anytime to update chunks (old chunks are replaced)</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Assets table */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Document
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Kind
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Chunks
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {assets.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No policy documents uploaded yet.{" "}
                  <a href="/banks/settings/documents" className="text-blue-600 underline">
                    Upload one now →
                  </a>
                </td>
              </tr>
            ) : (
              assets.map((asset) => {
                const chunks = chunkStats.get(asset.id) || 0;
                const isProcessing = processing === asset.id;

                return (
                  <tr key={asset.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{asset.title}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(asset.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        {asset.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {chunks > 0 ? (
                        <span className="text-green-700 font-medium">
                          {chunks} chunks
                        </span>
                      ) : (
                        <span className="text-gray-400">Not ingested</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleIngest(asset.id)}
                          disabled={isProcessing}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isProcessing ? "Processing..." : chunks > 0 ? "Re-ingest" : "Ingest"}
                        </button>
                        {chunks > 0 && (
                          <>
                            <a
                              href={`/banks/settings/policy-chunks?asset_id=${asset.id}`}
                              className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
                            >
                              View Chunks
                            </a>
                            <button
                              onClick={() => handleDeleteChunks(asset.id)}
                              disabled={isProcessing}
                              className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              Delete Chunks
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
