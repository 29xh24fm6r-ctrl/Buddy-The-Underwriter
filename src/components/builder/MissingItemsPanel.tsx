"use client";

export function MissingItemsPanel({ items }: { items: string[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-600/10 p-4">
        <div className="text-sm font-semibold text-emerald-300">All clear</div>
        <div className="text-xs text-emerald-300/70">No missing required items.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-600/10 p-4 space-y-2">
      <div className="text-sm font-semibold text-amber-300">
        Missing Items ({items.length})
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-amber-200/80">
            <span className="mt-0.5 text-amber-400">&#9679;</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
