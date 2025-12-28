"use client";

export type PolicyChunk = {
  chunk_key: string;
  title?: string;
  content: string;
  metadata?: any;
};

export function PolicyCard({ p }: { p: PolicyChunk }) {
  const excerpt = (p.content ?? "").slice(0, 220);
  return (
    <div className="rounded-2xl border p-4 shadow-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{p.title ?? p.chunk_key}</div>
          <div className="text-xs text-muted-foreground">{p.chunk_key}</div>
        </div>
        <span className="text-xs rounded-full border px-2 py-1">Snapshot</span>
      </div>
      <div className="text-sm text-muted-foreground">{excerpt}{(p.content?.length ?? 0) > 220 ? "…" : ""}</div>
    </div>
  );
}
