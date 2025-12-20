"use client";

import { useState, useEffect } from "react";

interface IngestionStats {
  total_assets: number;
  total_chunks: number;
  ingested_assets: number;
  not_ingested_assets: number;
}

export function PolicyIngestionCard() {
  const [stats, setStats] = useState<IngestionStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      setLoading(true);
      
      // Load assets
      const assetsRes = await fetch("/api/banks/assets/list");
      const assetsJson = await assetsRes.json();
      const assets = assetsJson.assets || [];
      
      // Load chunks
      const chunksRes = await fetch("/api/banks/policy/chunks");
      const chunksJson = await chunksRes.json();
      const chunks = chunksJson.chunks || [];
      
      // Count unique assets with chunks
      const assetIdsWithChunks = new Set(chunks.map((c: any) => c.asset_id));
      
      setStats({
        total_assets: assets.length,
        total_chunks: chunks.length,
        ingested_assets: assetIdsWithChunks.size,
        not_ingested_assets: assets.length - assetIdsWithChunks.size,
      });
    } catch (err) {
      console.error("Failed to load ingestion stats:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold mb-2">Policy Ingestion</h3>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold mb-2">Policy Ingestion</h3>
        <p className="text-sm text-red-600">Failed to load stats</p>
      </div>
    );
  }

  const ingestionRate = stats.total_assets > 0
    ? Math.round((stats.ingested_assets / stats.total_assets) * 100)
    : 0;

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Policy Ingestion</h3>
        <a
          href="/banks/settings/policy-ingestion"
          className="text-sm text-blue-600 hover:underline"
        >
          Manage →
        </a>
      </div>

      <div className="space-y-4">
        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-700">Coverage</span>
            <span className="text-sm text-gray-500">{ingestionRate}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${ingestionRate}%` }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-2xl font-bold text-gray-900">
              {stats.total_chunks.toLocaleString()}
            </div>
            <div className="text-xs text-gray-500">Total Chunks</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">
              {stats.ingested_assets}
            </div>
            <div className="text-xs text-gray-500">Documents Ingested</div>
          </div>
        </div>

        {/* Warning if not all ingested */}
        {stats.not_ingested_assets > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
            <div className="flex gap-2">
              <span className="text-yellow-600">⚠️</span>
              <div className="text-xs text-yellow-800">
                <span className="font-medium">{stats.not_ingested_assets} document(s)</span> not yet ingested
              </div>
            </div>
          </div>
        )}

        {/* Quick action */}
        <a
          href="/banks/settings/policy-ingestion"
          className="block w-full px-4 py-2 bg-blue-50 text-blue-700 text-sm font-medium rounded hover:bg-blue-100 text-center"
        >
          Ingest Policy Documents
        </a>
      </div>
    </div>
  );
}
