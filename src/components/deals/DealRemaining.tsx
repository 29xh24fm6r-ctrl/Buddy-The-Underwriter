export function DealRemaining({
  items,
}: {
  items: Array<{ key: string; label: string }> | null | undefined;
}) {
  if (!items?.length) return null;

  return (
    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 text-xs text-slate-400">Still needed</div>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.key} className="text-sm text-slate-200">
            • {i.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
