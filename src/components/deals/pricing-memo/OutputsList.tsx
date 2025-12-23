"use client";

type GeneratedDocument = {
  id: string;
  doc_type: string;
  title: string;
  status: string;
  pdf_storage_path: string | null;
  created_at: string;
};

export function OutputsList({
  dealId,
  documents,
}: {
  dealId: string;
  documents: GeneratedDocument[];
}) {
  const handleDownload = async (doc: GeneratedDocument) => {
    if (!doc.pdf_storage_path) {
      alert("PDF not yet generated");
      return;
    }

    try {
      // Request signed URL from new endpoint
      const res = await fetch(`/api/deals/${dealId}/memos/${doc.id}/signed-url`);

      if (!res.ok) throw new Error("Failed to get signed URL");

      const data = await res.json();
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error("Error opening PDF:", error);
      alert("Failed to open PDF");
    }
  };

  const handlePreview = (doc: GeneratedDocument) => {
    window.open(
      `/deals/${dealId}/memos/${doc.id}/preview`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  if (documents.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/50 p-6 text-center">
        <p className="text-sm text-gray-400">No generated documents yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-white">Generated Documents</h3>
      
      <div className="space-y-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 p-4"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-white">{doc.title}</h4>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    doc.status === "final"
                      ? "bg-green-500/20 text-green-300"
                      : "bg-gray-500/20 text-gray-300"
                  }`}
                >
                  {doc.status}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-4 text-xs text-gray-400">
                <span>{doc.doc_type}</span>
                <span>•</span>
                <span>{new Date(doc.created_at).toLocaleString()}</span>
                {doc.pdf_storage_path && (
                  <>
                    <span>•</span>
                    <span className="text-green-400">PDF Available</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handlePreview(doc)}
                className="rounded-md border border-white/20 bg-black/50 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10"
              >
                Preview
              </button>
              {doc.pdf_storage_path ? (
                <button
                  onClick={() => handleDownload(doc)}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  View PDF
                </button>
              ) : (
                <span className="text-xs text-gray-500">No PDF</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
