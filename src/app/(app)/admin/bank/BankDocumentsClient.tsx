"use client";

import { useState, useEffect } from "react";

type BankDocument = {
  id: string;
  bank_id: string;
  title: string;
  description: string | null;
  category: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
};

const CATEGORIES = ["general", "policy", "guideline", "template", "compliance"];

export default function BankDocumentsClient({ bankId }: { bankId: string }) {
  const [documents, setDocuments] = useState<BankDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload form
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [filename, setFilename] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  async function fetchDocuments() {
    setLoading(true);
    try {
      const res = await fetch("/api/bank/documents");
      const json = await res.json();
      if (json.ok) {
        setDocuments(json.documents ?? []);
      } else {
        setError(json.error ?? "Failed to load documents");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!title.trim() || !filename.trim()) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const res = await fetch("/api/bank/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          category,
          original_filename: filename.trim(),
        }),
      });
      const json = await res.json();
      if (json.ok && json.document) {
        setDocuments((prev) => [json.document, ...prev]);
        setTitle("");
        setDescription("");
        setCategory("general");
        setFilename("");
        setShowForm(false);
        setUploadMsg("Document added");
      } else {
        setUploadMsg(json.error ?? "Upload failed");
      }
    } catch {
      setUploadMsg("Network error");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <div className="text-white/60 text-sm">Loading documents...</div>;
  }

  if (error) {
    return <div className="text-rose-400 text-sm">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-white/50">{documents.length} document(s)</div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary/90"
        >
          {showForm ? "Cancel" : "Add Document"}
        </button>
      </div>

      {uploadMsg && (
        <div
          className={`text-sm ${uploadMsg === "Document added" ? "text-emerald-400" : "text-rose-400"}`}
        >
          {uploadMsg}
        </div>
      )}

      {showForm && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Document title"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Filename</label>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="policy.pdf"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description..."
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
          </div>
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || !title.trim() || !filename.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {uploading ? "Adding..." : "Add Document"}
          </button>
        </div>
      )}

      {documents.length === 0 && !showForm && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-center text-sm text-white/50">
          No documents yet. Click &quot;Add Document&quot; to upload bank policies and guidelines.
        </div>
      )}

      {documents.length > 0 && (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 flex items-center justify-between"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{doc.title}</div>
                <div className="text-xs text-white/50 flex items-center gap-2 mt-0.5">
                  <span>{doc.original_filename}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px]">{doc.category}</span>
                  {doc.size_bytes != null && (
                    <span>{(doc.size_bytes / 1024).toFixed(0)} KB</span>
                  )}
                </div>
                {doc.description && (
                  <div className="text-xs text-white/40 mt-1 truncate">{doc.description}</div>
                )}
              </div>
              <div className="text-xs text-white/30 shrink-0 ml-4">
                {new Date(doc.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
