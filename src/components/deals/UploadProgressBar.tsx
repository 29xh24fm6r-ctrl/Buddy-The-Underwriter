// src/components/deals/UploadProgressBar.tsx
"use client";

import { cn } from "@/lib/utils";

export type UploadStatus = {
  ok: boolean;
  status: "processing" | "blocked" | "ready";
  total: number;
  processed: number;
  remaining: number;
  documents?: Array<{
    id: string;
    document_key: string;
    matched: boolean;
  }>;
};

export function UploadProgressBar({ status }: { status: UploadStatus }) {
  const percent =
    status.total === 0
      ? 100
      : Math.round((status.processed / status.total) * 100);

  return (
    <div className="space-y-1">
      <div className="h-2 w-full bg-gray-800 rounded overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-500 ease-out",
            status.status === "ready"
              ? "bg-green-500"
              : "bg-blue-500 animate-pulse"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="text-xs text-gray-400">
        {status.status === "ready"
          ? "✓ All documents received"
          : `Processing ${status.processed}/${status.total} documents…`}
      </div>
    </div>
  );
}
