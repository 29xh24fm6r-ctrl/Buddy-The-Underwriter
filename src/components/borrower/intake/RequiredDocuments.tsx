"use client";
import { useCallback, useEffect, useState } from "react";
import type { PackageDocumentReadiness } from "@/lib/borrower/documents/packageChecklist";

export function RequiredDocuments({ refreshKey, onChooseDocument }: { refreshKey: number; onChooseDocument?: (item: { key: string; title: string }) => void }) {
  const [result, setResult] = useState<PackageDocumentReadiness | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/borrower/intake/document-readiness", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok || !Array.isArray(data.items) || !Array.isArray(data.reasons)) throw new Error();
      setResult(data); setError("");
    } catch { setResult(null); setError("Your document checklist could not be loaded. Please refresh."); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return <section aria-label="Required application documents" className="my-4 space-y-3 rounded-xl border p-4">
    <h4 className="font-semibold">Your document checklist</h4>
    <p className="text-sm text-slate-600">Buddy checks the files and requested years. Some are needed before package preparation; franchise documents must be included before lender submission. Uploading alone does not complete a request.</p>
    {error && <p role="alert">{error}</p>}
    {!result && !error && <p role="status">Loading your checklist…</p>}
    {result?.items.length === 0 && <p role="alert">{result.reasons.join(" ")}</p>}
    {result && result.items.length > 0 && result.reasons.filter(reason =>
      !result.items.some(item => reason.startsWith(`${item.title}:`))
    ).map(reason => <p role="alert" key={reason}>{reason}</p>)}
    <ul className="space-y-3">{result?.items.map(item => <li key={item.key}>
      <p className="font-medium">{item.title} — {item.state === "complete" ? "Ready" : item.state === "not_applicable" ? "Not required" : item.state === "prepared_by_buddy" ? "Buddy prepares this" : "Needed"}</p>
      <p className="text-sm text-slate-600">{item.detail}</p>
      {item.state === "missing" && onChooseDocument && <button type="button" className="text-sm font-medium underline" onClick={() => onChooseDocument({ key: item.key, title: item.title })}>Upload {item.title}</button>}
    </li>)}</ul>
    <button type="button" className="text-sm font-medium underline" onClick={() => void load()}>Refresh document checklist</button>
  </section>;
}
