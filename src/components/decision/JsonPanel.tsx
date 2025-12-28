/**
 * JsonPanel - Collapsible JSON viewer for decision snapshots
 */
"use client";

import { useState } from "react";

export function JsonPanel({ title, data }: { title: string; data: any }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left font-medium"
      >
        <span>{title}</span>
        <span className="text-gray-500">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <pre className="mt-3 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-96">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
