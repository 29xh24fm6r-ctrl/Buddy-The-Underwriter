// src/app/upload/[token]/UploadFormClient.tsx
"use client";

import React, { useMemo, useState } from "react";

type Props = { token: string };

type ApiOk = {
  ok: true;
  dealId: string;
  label?: string | null;
  requirePassword: boolean;
  expiresAt: string;
};

type ApiErr = { ok: false; error: string };

export default function UploadFormClient({ token }: Props) {
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [checklistKey, setChecklistKey] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [meta, setMeta] = useState<ApiOk | null>(null);

  const canSubmit = useMemo(() => !!files && files.length > 0 && !busy, [files, busy]);

  async function loadMeta() {
    setStatus(null);
    const res = await fetch(`/api/public/upload-link/meta?token=${encodeURIComponent(token)}`);
    const json = (await res.json()) as ApiOk | ApiErr;
    if (!json.ok) {
      setStatus(json.error);
      return;
    }
    setMeta(json);
    setStatus(null);
  }

  React.useEffect(() => {
    void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files || files.length === 0) return;

    setBusy(true);
    setStatus("Uploading…");

    try {
      const form = new FormData();
      form.append("token", token);
      if (password) form.append("password", password);
      if (name) form.append("uploaderName", name);
      if (email) form.append("uploaderEmail", email);
      if (checklistKey) form.append("checklistKey", checklistKey);

      // append all files
      for (let i = 0; i < files.length; i++) {
        form.append("files", files[i]);
      }

      const res = await fetch("/api/public/upload", { method: "POST", body: form });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setStatus(json?.error || "Upload failed.");
        setBusy(false);
        return;
      }

      setStatus(`Upload complete: ${json.count} file(s). Thank you!`);
      setFiles(null);
      const fileInput = document.getElementById("fileInput") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      // Reload meta (in case single-use link becomes used)
      await loadMeta();
    } catch (err: any) {
      setStatus(err?.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  const locked = meta ? new Date(meta.expiresAt).getTime() < Date.now() : false;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {meta?.label ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 text-sm text-neutral-200">
          <span className="text-neutral-400">Request:</span> {meta.label}
        </div>
      ) : null}

      {locked ? (
        <div className="rounded-xl border border-red-900/40 bg-red-950/30 p-3 text-sm text-red-200">
          This upload link has expired.
        </div>
      ) : null}

      {meta?.requirePassword ? (
        <div>
          <label className="text-sm text-neutral-300">Password</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            placeholder="Enter password"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm text-neutral-300">Your name (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            placeholder="Jane Borrower"
          />
        </div>
        <div>
          <label className="text-sm text-neutral-300">Your email (optional)</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            placeholder="jane@example.com"
          />
        </div>
      </div>

      <div>
        <label className="text-sm text-neutral-300">Checklist key (optional)</label>
        <input
          value={checklistKey}
          onChange={(e) => setChecklistKey(e.target.value)}
          className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
          placeholder="e.g. IRS_1120_2024"
        />
        <p className="mt-1 text-xs text-neutral-500">
          If you were asked for a specific item, paste its key here.
        </p>
      </div>

      <div>
        <label className="text-sm text-neutral-300">Files</label>
        <input
          id="fileInput"
          type="file"
          multiple
          onChange={(e) => setFiles(e.target.files)}
          className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit || locked}
        className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload"}
      </button>

      {status ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 text-sm text-neutral-200">
          {status}
        </div>
      ) : null}
    </form>
  );
}
