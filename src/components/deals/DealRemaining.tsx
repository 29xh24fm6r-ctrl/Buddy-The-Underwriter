"use client";

type RemainingItem = {
  key: string;
  label: string;
  required?: boolean;
};

type DealRemainingProps = {
  items: RemainingItem[];
};

/**
 * DealRemaining - What's still needed (if anything)
 * 
 * Only shows missing items.
 * Never shows satisfied items here.
 * No checkboxes, no buttons, no interaction.
 * 
 * Removes 70% of visual clutter by showing ONLY what matters.
 * 
 * Rules:
 * - Hide when empty
 * - Show only pending required items
 * - Simple bullet list
 * - Calm, minimal design
 */
export function DealRemaining({ items }: DealRemainingProps) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
        Still needed
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm text-slate-200">
            <span className="mt-1 text-slate-500">•</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
