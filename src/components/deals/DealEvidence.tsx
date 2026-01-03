type EvidenceDoc = {
  id: string;
  title: string;
  checklist_key?: string | null;
  matched?: boolean;
};

export function DealEvidence({ docs }: { docs: EvidenceDoc[] }) {
  if (!docs || docs.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Evidence Received
      </div>

      <div className="grid grid-cols-1 gap-2">
        {docs.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <span className="text-slate-800">{doc.title}</span>

            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                doc.matched
                  ? "bg-green-100 text-green-800"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {doc.matched ? "Matched" : "Received"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
