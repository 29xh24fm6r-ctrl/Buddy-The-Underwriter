/**
 * BorrowerEvidence — What we've already received
 * 
 * Simpler than banker version:
 * - Just document names
 * - "Received" timestamp
 * - No categories, no statuses
 */

interface BorrowerEvidenceProps {
  documents: Array<{
    id: string;
    name: string;
    uploadedAt: string;
  }>;
}

export function BorrowerEvidence({ documents }: BorrowerEvidenceProps) {
  if (documents.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="text-slate-400 text-sm font-medium">Already Received</div>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="rounded-lg bg-slate-900/40 px-4 py-3 text-sm"
          >
            <div className="text-slate-200">{doc.name}</div>
            <div className="text-slate-500 text-xs mt-1">
              Received {new Date(doc.uploadedAt).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
