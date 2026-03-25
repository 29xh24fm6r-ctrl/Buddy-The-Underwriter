"use client";

import type { BuilderReadinessBlocker, BuilderStepKey } from "@/lib/builder/builderTypes";

type Props = {
  items: BuilderReadinessBlocker[];
  onNavigate?: (step: BuilderStepKey, action?: string, fieldPath?: string) => void;
};

export function MissingItemsPanel({ items, onNavigate }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-600/10 p-4">
        <div className="text-sm font-semibold text-emerald-300">All clear</div>
        <div className="text-xs text-emerald-300/70">No missing required items.</div>
      </div>
    );
  }

  const blockers = items.filter((i) => i.severity === "blocker");
  const warnings = items.filter((i) => i.severity === "warning");

  return (
    <div className="space-y-2">
      {blockers.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-600/10 p-4 space-y-2">
          <div className="text-sm font-semibold text-amber-300">
            Required ({blockers.length})
          </div>
          <ItemList items={blockers} onNavigate={onNavigate} />
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-yellow-500/15 bg-yellow-600/5 p-4 space-y-2">
          <div className="text-sm font-semibold text-yellow-300/80">
            Warnings ({warnings.length})
          </div>
          <ItemList items={warnings} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

function ItemList({ items, onNavigate }: { items: BuilderReadinessBlocker[]; onNavigate: Props["onNavigate"] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.key} className="flex items-start gap-2 text-xs text-amber-200/80">
          <span className={`mt-0.5 ${item.severity === "warning" ? "text-yellow-400" : "text-amber-400"}`}>&#9679;</span>
          {onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate(item.target.step, item.target.action, item.target.field_path)}
              className="text-left hover:text-amber-100 hover:underline underline-offset-2 transition-colors"
            >
              {item.label}
            </button>
          ) : (
            item.label
          )}
        </li>
      ))}
    </ul>
  );
}
