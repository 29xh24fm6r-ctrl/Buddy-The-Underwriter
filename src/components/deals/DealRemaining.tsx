type RemainingItem = {
  key: string;
  label: string;
  required?: boolean;
};

type DealRemainingProps = {
  items?: RemainingItem[] | null;
};

/**
 * DealRemaining
 *
 * Purpose:
 * - Show what is still required, if anything
 * - No actions, no buttons, no urgency
 * - Calm, minimal, factual
 */
export function DealRemaining({ items }: DealRemainingProps) {
  if (!items || items.length === 0) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Still needed
      </div>

      <ul className="space-y-1 text-sm text-slate-700">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            <span>{item.label}</span>
            {item.required && (
              <span className="text-xs text-slate-400">(required)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
