// src/app/banks/settings/documents/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

// ============ Types ============

type BankDocument = {
  id: string;
  bank_id: string;
  title: string;
  description: string | null;
  category: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

type BankAsset = {
  id: string;
  bank_id: string;
  kind: "policy" | "form_template" | "sop" | "checklist" | "rate_sheet" | "other";
  title: string;
  description: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  version: number;
  active: boolean;
  created_at: string;
};

const KINDS: BankAsset["kind"][] = ["policy", "form_template", "sop", "checklist", "rate_sheet", "other"];

export const dynamic = "force-dynamic";

// ============ Component ============

export default function BankDocumentsPage() {
  // Credit Policy state
  const [creditPolicyDocs, setCreditPolicyDocs] = useState<BankDocument[]>([]);
  const [cpBusy, setCpBusy] = useState(false);
  const [cpErr, setCpErr] = useState<string | null>(null);
  const [cpTitle, setCpTitle] = useState("");
  const [cpDescription, setCpDescription] = useState("");
  const [cpFile, setCpFile] = useState<File | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Bank Knowledge Vault state (existing)
  const [vaultItems, setVaultItems] = useState<BankAsset[]>([]);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultErr, setVaultErr] = useState<string | null>(null);
  const [vaultKind, setVaultKind] = useState<BankAsset["kind"]>("policy");
  const [vaultTitle, setVaultTitle] = useState("");
  const [vaultDescription, setVaultDescription] = useState("");
  const [vaultFile, setVaultFile] = useState<File | null>(null);

  const canUploadCp = useMemo(() => !!cpFile && !cpBusy, [cpFile, cpBusy]);
  const canUploadVault = useMemo(() => !!vaultFile && vaultTitle.trim().length > 0 && !vaultBusy, [vaultFile, vaultTitle, vaultBusy]);

  // ============ Credit Policy Functions ============

  async function refreshCreditPolicy() {
    setCpErr(null);
    const res = await fetch("/api/banks/documents/list", { method: "GET" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      if (res.status === 401 || json?.error === "not_authenticated") {
        window.location.href = "/sign-in";
        return;
      }
      if (res.status === 403 || json?.error === "forbidden") {
        setCpErr("You don't have admin access to view documents.");
        return;
      }
      setCpErr("Failed to load credit policy documents.");
      return;
    }
    setCreditPolicyDocs(json.documents || []);
  }

  async function uploadCreditPolicy() {
    if (!cpFile) return;

    setCpBusy(true);
    setCpErr(null);
    try {
      const fd = new FormData();
      fd.append("file", cpFile);
      fd.append("title", cpTitle.trim() || cpFile.name);
      fd.append("description", cpDescription.trim());
      fd.append("category", "CREDIT_POLICY");

      const res = await fetch("/api/banks/documents/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        if (res.status === 401 || json?.error === "not_authenticated") {
          window.location.href = "/sign-in";
          return;
        }
        if (res.status === 403 || json?.error === "forbidden") {
          setCpErr("You don't have admin access to upload documents.");
          return;
        }
        if (json?.error === "invalid_file_type") {
          setCpErr("Invalid file type. Allowed: PDF, DOC, DOCX, PNG, JPG");
          return;
        }
        setCpErr(json?.detail || "Upload failed. Please try again.");
        return;
      }

      setCpTitle("");
      setCpDescription("");
      setCpFile(null);
      // Reset file input
      const fileInput = document.getElementById("cp-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      await refreshCreditPolicy();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCpErr(msg || "upload_failed");
    } finally {
      setCpBusy(false);
    }
  }

  async function downloadDocument(docId: string) {
    setDownloadingId(docId);
    setCpErr(null);
    try {
      const res = await fetch(`/api/banks/documents/${docId}/signed-url`, { method: "POST" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        if (res.status === 401 || json?.error === "not_authenticated") {
          window.location.href = "/sign-in";
          return;
        }
        setCpErr("Failed to generate download link.");
        return;
      }

      window.open(json.url, "_blank");
    } catch {
      setCpErr("Failed to download document.");
    } finally {
      setDownloadingId(null);
    }
  }

  // ============ Bank Knowledge Vault Functions (existing) ============

  async function refreshVault() {
    setVaultErr(null);
    const res = await fetch("/api/banks/assets/list", { method: "GET" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      if (res.status === 401 || json?.error === "not_authenticated") {
        window.location.href = "/sign-in";
        return;
      }
      setVaultErr("Failed to load vault documents. Please try refreshing the page.");
      return;
    }
    setVaultItems(json.items || []);
  }

  async function uploadVault() {
    if (!vaultFile) return;

    setVaultBusy(true);
    setVaultErr(null);
    try {
      const fd = new FormData();
      fd.append("kind", vaultKind);
      fd.append("title", vaultTitle.trim());
      fd.append("description", vaultDescription.trim() || "");
      fd.append("file", vaultFile);

      const res = await fetch("/api/banks/assets/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        if (res.status === 401 || json?.error === "not_authenticated") {
          window.location.href = "/sign-in";
          return;
        }
        setVaultErr(json?.error === "upload_failed" ? "Upload failed. Please try again." : "Something went wrong during upload.");
        return;
      }

      setVaultTitle("");
      setVaultDescription("");
      setVaultFile(null);
      await refreshVault();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setVaultErr(msg || "upload_failed");
    } finally {
      setVaultBusy(false);
    }
  }

  // ============ Effects ============

  useEffect(() => {
    refreshCreditPolicy();
    refreshVault();
  }, []);

  // ============ Render ============

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-8">
      {/* ============ Credit Policy Section ============ */}
      <section>
        <div className="mb-4">
          <h1 className="text-3xl font-bold">Bank Credit Policy</h1>
          <p className="text-muted-foreground mt-2">
            Upload your bank's credit policy so Buddy can underwrite according to your standards.
          </p>
        </div>

        {cpErr && (
          <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm mb-4">
            {cpErr}
          </div>
        )}

        {creditPolicyDocs.length === 0 ? (
          /* Empty state */
          <div className="rounded-2xl border border-dashed p-8 text-center">
            <div className="text-lg font-semibold text-muted-foreground mb-2">
              No credit policy uploaded yet
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Upload your bank's credit policy document to help Buddy make better underwriting decisions.
            </p>
            <div className="max-w-md mx-auto space-y-3">
              <input
                id="cp-file-input"
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(e) => setCpFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Title (optional, defaults to filename)"
                value={cpTitle}
                onChange={(e) => setCpTitle(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={cpDescription}
                onChange={(e) => setCpDescription(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
              <button
                disabled={!canUploadCp}
                onClick={uploadCreditPolicy}
                className="w-full rounded-xl border px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50"
              >
                {cpBusy ? "Uploading..." : "Upload Credit Policy"}
              </button>
            </div>
          </div>
        ) : (
          /* List state */
          <div className="space-y-4">
            {/* Upload form */}
            <div className="rounded-2xl border p-5 space-y-4">
              <div className="text-sm font-semibold">Upload New Document</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  id="cp-file-input"
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={(e) => setCpFile(e.target.files?.[0] ?? null)}
                  className="rounded-xl border px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Title (optional)"
                  value={cpTitle}
                  onChange={(e) => setCpTitle(e.target.value)}
                  className="rounded-xl border px-3 py-2 text-sm"
                />
                <button
                  disabled={!canUploadCp}
                  onClick={uploadCreditPolicy}
                  className="rounded-xl border px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {cpBusy ? "Uploading..." : "Upload"}
                </button>
              </div>
            </div>

            {/* Documents table */}
            <div className="rounded-2xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Title</th>
                    <th className="text-left px-4 py-3 font-semibold">Category</th>
                    <th className="text-left px-4 py-3 font-semibold">Filename</th>
                    <th className="text-left px-4 py-3 font-semibold">Uploaded</th>
                    <th className="text-right px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {creditPolicyDocs.map((doc) => (
                    <tr key={doc.id} className="border-t">
                      <td className="px-4 py-3 font-medium">{doc.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">{doc.category}</td>
                      <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">
                        {doc.original_filename}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => downloadDocument(doc.id)}
                          disabled={downloadingId === doc.id}
                          className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                        >
                          {downloadingId === doc.id ? "..." : "Download"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Divider */}
      <hr className="border-t" />

      {/* ============ Bank Knowledge Vault Section (existing) ============ */}
      <section>
        <div className="mb-4">
          <h2 className="text-2xl font-bold">Bank Knowledge Vault</h2>
          <p className="text-muted-foreground mt-2">
            Upload your bank's SOPs, fillable form templates, and other documents for RAG ingestion.
          </p>
        </div>

        <div className="rounded-2xl border p-5 space-y-4">
          {vaultErr && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              {vaultErr}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold">Kind</label>
              <select
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                value={vaultKind}
                onChange={(e) => setVaultKind(e.target.value as BankAsset["kind"])}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-semibold">Title</label>
              <input
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                value={vaultTitle}
                onChange={(e) => setVaultTitle(e.target.value)}
                placeholder="e.g., Credit Policy 2025"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-semibold">Description (optional)</label>
              <input
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                value={vaultDescription}
                onChange={(e) => setVaultDescription(e.target.value)}
                placeholder="What is this document used for?"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-semibold">File</label>
              <input
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                type="file"
                onChange={(e) => setVaultFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <button
            disabled={!canUploadVault}
            onClick={uploadVault}
            className="rounded-xl border px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50"
          >
            {vaultBusy ? "Uploading..." : "Upload"}
          </button>
        </div>

        <div className="rounded-2xl border p-5 mt-4">
          <div className="text-sm font-semibold">Current Vault Items</div>
          <div className="mt-3 space-y-2">
            {vaultItems.length === 0 ? (
              <div className="text-sm text-muted-foreground">No documents uploaded yet.</div>
            ) : (
              vaultItems.map((it) => (
                <div key={it.id} className="rounded-xl border p-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">{it.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {it.kind} · v{it.version} · {it.active ? "active" : "inactive"} ·{" "}
                      {new Date(it.created_at).toLocaleString()}
                    </div>
                    {it.description && (
                      <div className="text-sm text-muted-foreground mt-2">{it.description}</div>
                    )}
                    <div className="text-xs text-muted-foreground mt-2 break-words">{it.storage_path}</div>
                  </div>

                  <form action="/api/banks/assets/disable" method="post">
                    <input type="hidden" name="id" value={it.id} />
                    <button className="rounded-xl border px-3 py-2 text-xs font-semibold">Disable</button>
                  </form>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
