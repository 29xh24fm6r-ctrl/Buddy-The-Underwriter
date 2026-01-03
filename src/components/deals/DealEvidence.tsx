export function DealEvidence({
  docs,
}: {
  docs: Array<{ id: string; display_name: string }> | null | undefined;
}) {
  if (!docs?.length) return null;

  return (
    <div className="mt-6">
      <div className="mb-2 text-xs text-slate-400">Received & verified</div>
      <div className="space-y-2">
        {docs.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm"
          >
            <span className="text-slate-200">{d.display_name}</span>
            <span className="text-emerald-400 text-xs">Matched</span>
          </div>
        ))}
      </div>
    </div>
  );
}
