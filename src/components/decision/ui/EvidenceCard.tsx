"use client";

export type Evidence = {
  key: string;
  label?: string;
  value: any;
  source?: { filename?: string; page?: number; snippet?: string } | null;
  confidence?: number | null;
};

export function EvidenceCard({ e }: { e: Evidence }) {
  const pct = e.confidence == null ? null : Math.round(e.confidence * 100);
  return (
    <div className="rounded-2xl border p-4 shadow-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{e.label ?? e.key}</div>
          <div className="text-xs text-muted-foreground">{e.key}</div>
        </div>
        <div className="text-xs rounded-full border px-2 py-1">
          {pct == null ? "Unscored" : `${pct}%`}
        </div>
      </div>

      <div className="text-sm">
        <span className="font-medium">Value:</span>{" "}
        <span className="font-mono">{String(e.value ?? "")}</span>
      </div>

      {e.source ? (
        <div className="text-xs text-muted-foreground">
          Source: {e.source.filename ?? "document"}
          {e.source.page ? ` • page ${e.source.page}` : ""}
          {e.source.snippet ? (
            <div className="mt-1 rounded-xl bg-muted p-2 text-[11px]">
              {e.source.snippet}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Source: not provided</div>
      )}
    </div>
  );
}
