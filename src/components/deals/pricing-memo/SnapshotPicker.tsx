"use client";

import { useState } from "react";

type Snapshot = {
  id: string;
  version: number;
  created_at: string;
  context: any;
};

export function SnapshotPicker({
  snapshots,
  selectedId,
  onSelect,
}: {
  snapshots: Snapshot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-300">Snapshot Version</label>
      <select
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">Select snapshot...</option>
        {snapshots.map((snap) => (
          <option key={snap.id} value={snap.id}>
            v{snap.version} - {new Date(snap.created_at).toLocaleString()}
          </option>
        ))}
      </select>
      
      {selectedId && (
        <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-3">
          <p className="text-xs text-gray-400">
            Selected: {snapshots.find(s => s.id === selectedId)?.version 
              ? `Version ${snapshots.find(s => s.id === selectedId)?.version}`
              : "Unknown"}
          </p>
        </div>
      )}
    </div>
  );
}
