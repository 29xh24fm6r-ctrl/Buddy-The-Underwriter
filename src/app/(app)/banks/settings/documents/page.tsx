// src/app/(app)/banks/settings/documents/page.tsx
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

// Input styling constants (matches ProfileClient)
const INPUT_CLS =
  "w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white " +
  "placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20";

const FILE_INPUT_CLS =
  "w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white " +
  "file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white " +
  "focus:outline-none focus:ring-2 focus:ring-white/20";

const SELECT_CLS =
  "w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white " +
  "focus:outline-none focus:ring-2 focus:ring-white/20";

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

  // ============ Bank Knowledge Vault Functions ============

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
      const fileInput = document.getElementById("vault-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
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
    <div className="min-h-screen bg-gradient-to-b from-black/20 to-transparent">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="space-y-8">
          {/* ============ Credit Policy Section ============ */}
          <section className="rounded-2xl border border-white/10 bg-black/30 p-6 text-white shadow-sm">
            <header>
              <h1 className="text-2xl font-semibold tracking-tight">Bank Credit Policy</h1>
              <p className="mt-1 text-sm text-white/60">
                Upload your bank's credit policy so Buddy can underwrite according to your standards.
              </p>
            </header>

            {cpErr && (
              <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                {cpErr}
              </div>
            )}

            <div className="mt-6">
              {creditPolicyDocs.length === 0 ? (
                /* Empty state */
                <div className="rounded-2xl border border-dashed border-white/20 p-8 text-center">
                  <div className="text-lg font-semibold text-white/70 mb-2">
                    No credit policy uploaded yet
                  </div>
                  <p className="text-sm text-white/50 mb-6">
                    Upload your bank's credit policy document to help Buddy make better underwriting decisions.
                  </p>
                  <div className="max-w-md mx-auto space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-white/90 mb-1.5">
                        File
                      </label>
                      <input
                        id="cp-file-input"
                        type="file"
                        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                        onChange={(e) => setCpFile(e.target.files?.[0] ?? null)}
                        className={FILE_INPUT_CLS}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/90 mb-1.5">
                        Title <span className="text-white/40">(optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Defaults to filename"
                        value={cpTitle}
                        onChange={(e) => setCpTitle(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/90 mb-1.5">
                        Description <span className="text-white/40">(optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Brief description"
                        value={cpDescription}
                        onChange={(e) => setCpDescription(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!canUploadCp}
                      onClick={uploadCreditPolicy}
                      className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
                        cpBusy
                          ? "bg-white/60 text-black/70 cursor-wait"
                          : canUploadCp
                            ? "bg-white text-black hover:bg-white/90 active:scale-[0.98] shadow-md"
                            : "border border-white/15 text-white/30 cursor-not-allowed"
                      }`}
                    >
                      {cpBusy ? "Uploading..." : "Upload Credit Policy"}
                    </button>
                  </div>
                </div>
              ) : (
                /* List state with upload form */
                <div className="space-y-6">
                  {/* Inline upload form */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <h2 className="text-sm font-semibold tracking-wide text-white/90 uppercase mb-4">
                      Upload New Document
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <div>
                        <label className="block text-sm font-medium text-white/90 mb-1.5">File</label>
                        <input
                          id="cp-file-input"
                          type="file"
                          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                          onChange={(e) => setCpFile(e.target.files?.[0] ?? null)}
                          className={FILE_INPUT_CLS}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/90 mb-1.5">
                          Title <span className="text-white/40">(optional)</span>
                        </label>
                        <input
                          type="text"
                          placeholder="Defaults to filename"
                          value={cpTitle}
                          onChange={(e) => setCpTitle(e.target.value)}
                          className={INPUT_CLS}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={!canUploadCp}
                        onClick={uploadCreditPolicy}
                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                          cpBusy
                            ? "bg-white/60 text-black/70 cursor-wait"
                            : canUploadCp
                              ? "bg-white text-black hover:bg-white/90 active:scale-[0.98] shadow-md"
                              : "border border-white/15 text-white/30 cursor-not-allowed"
                        }`}
                      >
                        {cpBusy ? "Uploading..." : "Upload"}
                      </button>
                    </div>
                  </div>

                  {/* Documents table */}
                  <div className="rounded-2xl border border-white/10 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-white/[0.05]">
                        <tr>
                          <th className="text-left px-4 py-3 font-semibold text-white/90">Title</th>
                          <th className="text-left px-4 py-3 font-semibold text-white/90">Category</th>
                          <th className="text-left px-4 py-3 font-semibold text-white/90 hidden md:table-cell">Filename</th>
                          <th className="text-left px-4 py-3 font-semibold text-white/90">Uploaded</th>
                          <th className="text-right px-4 py-3 font-semibold text-white/90">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creditPolicyDocs.map((doc) => (
                          <tr key={doc.id} className="border-t border-white/10">
                            <td className="px-4 py-3 font-medium text-white">{doc.title}</td>
                            <td className="px-4 py-3 text-white/60">{doc.category}</td>
                            <td className="px-4 py-3 text-white/60 truncate max-w-[200px] hidden md:table-cell">
                              {doc.original_filename}
                            </td>
                            <td className="px-4 py-3 text-white/60">
                              {new Date(doc.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => downloadDocument(doc.id)}
                                disabled={downloadingId === doc.id}
                                className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            </div>
          </section>

          {/* ============ Bank Knowledge Vault Section ============ */}
          <section className="rounded-2xl border border-white/10 bg-black/30 p-6 text-white shadow-sm">
            <header>
              <h2 className="text-2xl font-semibold tracking-tight">Bank Knowledge Vault</h2>
              <p className="mt-1 text-sm text-white/60">
                Upload your bank's SOPs, fillable form templates, and other documents for RAG ingestion.
              </p>
            </header>

            {vaultErr && (
              <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                {vaultErr}
              </div>
            )}

            <div className="mt-6 space-y-6">
              {/* Upload form */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-semibold tracking-wide text-white/90 uppercase mb-4">
                  Upload Document
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-white/90 mb-1.5">Kind</label>
                    <select
                      className={SELECT_CLS}
                      value={vaultKind}
                      onChange={(e) => setVaultKind(e.target.value as BankAsset["kind"])}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k} className="bg-neutral-900 text-white">
                          {k.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/90 mb-1.5">Title</label>
                    <input
                      className={INPUT_CLS}
                      value={vaultTitle}
                      onChange={(e) => setVaultTitle(e.target.value)}
                      placeholder="e.g., Credit Policy 2025"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/90 mb-1.5">
                      Description <span className="text-white/40">(optional)</span>
                    </label>
                    <input
                      className={INPUT_CLS}
                      value={vaultDescription}
                      onChange={(e) => setVaultDescription(e.target.value)}
                      placeholder="What is this document used for?"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-white/90 mb-1.5">File</label>
                    <input
                      id="vault-file-input"
                      className={FILE_INPUT_CLS}
                      type="file"
                      onChange={(e) => setVaultFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    disabled={!canUploadVault}
                    onClick={uploadVault}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                      vaultBusy
                        ? "bg-white/60 text-black/70 cursor-wait"
                        : canUploadVault
                          ? "bg-white text-black hover:bg-white/90 active:scale-[0.98] shadow-md"
                          : "border border-white/15 text-white/30 cursor-not-allowed"
                    }`}
                  >
                    {vaultBusy ? "Uploading..." : "Upload"}
                  </button>
                </div>
              </div>

              {/* Current vault items */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-semibold tracking-wide text-white/90 uppercase mb-4">
                  Current Vault Items
                </h3>
                <div className="space-y-3">
                  {vaultItems.length === 0 ? (
                    <div className="text-sm text-white/50 py-4 text-center">
                      No documents uploaded yet.
                    </div>
                  ) : (
                    vaultItems.map((it) => (
                      <div
                        key={it.id}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">{it.title}</div>
                          <div className="text-xs text-white/50 mt-1 flex flex-wrap gap-x-2">
                            <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-white/80">
                              {it.kind.replace(/_/g, " ")}
                            </span>
                            <span>v{it.version}</span>
                            <span>{it.active ? "active" : "inactive"}</span>
                            <span>{new Date(it.created_at).toLocaleDateString()}</span>
                          </div>
                          {it.description && (
                            <div className="text-sm text-white/60 mt-2">{it.description}</div>
                          )}
                          <div className="text-xs text-white/40 mt-2 break-all font-mono">
                            {it.storage_path}
                          </div>
                        </div>

                        <form action="/api/banks/assets/disable" method="post" className="flex-shrink-0">
                          <input type="hidden" name="id" value={it.id} />
                          <button
                            type="submit"
                            className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                          >
                            Disable
                          </button>
                        </form>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
