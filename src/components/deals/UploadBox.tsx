// src/components/deals/UploadBox.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import BorrowerWowCard from "@/components/deals/BorrowerWowCard";
import FinancialStatementWowCard from "@/components/deals/FinancialStatementWowCard";

import MoodyPnlSpreadCard from "@/components/deals/MoodyPnlSpreadCard";
import buildMoodyPnlPackageFromC4 from "@/lib/finance/normalize/normalizePnlFromC4";




type UploadRecord = {
  file_id?: string;
  stored_name?: string;
  size: number;
  mime_type?: string;
  created_at?: string;
};

type Classification = {
  doc_type:
    | "IRS_1040"
    | "IRS_1065"
    | "IRS_1120"
    | "IRS_1120S"
    | "K1"
    | "PFS"
    | "BANK_STATEMENT"
    | "LEASE"
    | "FINANCIAL_STATEMENT"
    | "INVOICE"
    | "UNKNOWN";
  confidence: number;
  reasons: string[];
  tags: string[];
  tax_year: string | null;

  // C2+ extras
  pack?: boolean;
  subtypes?: string[];
  issuer_hint?: string | null;

  // C3-lite extras
  borrower?: {
    name?: string;
    address?: { raw?: string };
    ein_last4?: string;
    confidence?: number; // 0..1
  };
};

type OcrJob = {
  job_id: string;
  deal_id: string;
  stored_name?: string;
  file_name?: string;
  status: "queued" | "processing" | "succeeded" | "failed" | string;
  created_at: string;
  updated_at: string;
  result: any;
  error: any;
};

type Props = { dealId: string };
type ResultTab = "text" | "tables" | "raw";

function humanBytes(n: number) {
  if (!Number.isFinite(n)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let v = n;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx++;
  }
  return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function safeJson(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function extractTables(raw: any): any[] {
  const t = raw?.analyzeResult?.tables;
  return Array.isArray(t) ? t : [];
}

function tableToGrid(table: any): { rows: string[][]; rowCount: number; colCount: number } {
  const rowCount = Number(table?.rowCount ?? 0);
  const colCount = Number(table?.columnCount ?? 0);

  const grid: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => "")
  );

  const cells = Array.isArray(table?.cells) ? table.cells : [];
  for (const cell of cells) {
    const r = Number(cell?.rowIndex ?? -1);
    const c = Number(cell?.columnIndex ?? -1);
    const content = cell?.content ?? "";
    if (r >= 0 && c >= 0 && r < rowCount && c < colCount) {
      grid[r][c] = String(content);
    }
  }

  return { rows: grid, rowCount, colCount };
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return <>{text}</>;

  const q = query.trim();
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();

  const parts: React.ReactNode[] = [];
  let i = 0;

  while (i < text.length) {
    const idx = lower.indexOf(qLower, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={`${idx}-${i}`} className="rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
  }

  return <>{parts}</>;
}

function sanitizeFilenamePart(s: string) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
}

function downloadFile(filename: string, content: BlobPart, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function csvEscape(v: string) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function tablesToCsv(tables: any[]) {
  if (!Array.isArray(tables) || tables.length === 0) return "";

  const chunks: string[] = [];

  tables.forEach((t, idx) => {
    const grid = tableToGrid(t);

    chunks.push(`Table ${idx + 1}`);
    for (const row of grid.rows) {
      chunks.push(row.map(csvEscape).join(","));
    }
    chunks.push("");
  });

  return chunks.join("\n");
}

function prettyDocType(dt: string) {
  const map: Record<string, string> = {
    IRS_1040: "IRS 1040",
    IRS_1065: "IRS 1065",
    IRS_1120: "IRS 1120",
    IRS_1120S: "IRS 1120-S",
    K1: "K-1",
    PFS: "PFS",
    BANK_STATEMENT: "Bank Statement",
    LEASE: "Lease",
    FINANCIAL_STATEMENT: "Financial Statement",
    INVOICE: "Invoice",
    UNKNOWN: "Unknown",
  };
  return map[dt] ?? dt;
}

function prettySubtype(s: string) {
  const map: Record<string, string> = {
    SCHEDULE_C: "Schedule C",
    SCHEDULE_E: "Schedule E",
    SCHEDULE_F: "Schedule F",
    SCHEDULE_K1: "Schedule K-1",
    FORM_4562: "Form 4562 (Depreciation)",
    FORM_4797: "Form 4797",
    FORM_8825: "Form 8825 (Rental RE)",
    FORM_1125A: "Form 1125-A (COGS)",
    FORM_941: "Form 941",
    FORM_940: "Form 940",
    LEASE_NNN: "NNN Lease",
    LEASE_CAM: "CAM/OpEx",
    LEASE_BASE_RENT: "Base Rent",
  };
  return map[s] ?? s;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      {children}
    </span>
  );
}

export default function UploadBox({ dealId }: Props) {
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [jobs, setJobs] = useState<OcrJob[]>([]);
  const [busyUpload, setBusyUpload] = useState(false);
  const [busyOcr, setBusyOcr] = useState<string | null>(null);

  const [uiError, setUiError] = useState<string | null>(null);

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<OcrJob | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const [tab, setTab] = useState<ResultTab>("text");
  const [textSearch, setTextSearch] = useState("");
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const pollingAliveRef = useRef(false);
  const safeDealId = useMemo(() => encodeURIComponent(dealId), [dealId]);

  async function refreshUploads() {
    try {
      const res = await fetch(`/api/deals/${safeDealId}/uploads`, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(
          data?.error?.message ?? data?.error ?? `Uploads refresh failed (${res.status})`
        );
      }

      setUploads(Array.isArray(data.files) ? data.files : []);
    } catch (e: any) {
      setUiError(e?.message ?? String(e));
    }
  }

  async function refreshJobs() {
    try {
      const res = await fetch(`/api/deals/${safeDealId}/ocr/jobs`, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error?.message ?? data?.error ?? `Jobs refresh failed (${res.status})`);
      }

      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (e: any) {
      setUiError(e?.message ?? String(e));
    }
  }

  useEffect(() => {
    refreshUploads();
    refreshJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeDealId]);

  useEffect(() => {
    if (!dealId || !activeJobId) return;

    let alive = true;
    pollingAliveRef.current = true;
    setIsPolling(true);

    const pollOnce = async () => {
      try {
        const res = await fetch(
          `/api/deals/${safeDealId}/ocr/jobs?job_id=${encodeURIComponent(activeJobId)}`,
          { cache: "no-store" }
        );
        const data = await res.json().catch(() => null);

        if (!alive) return;

        if (res.status === 404) {
  // job file not visible yet — keep polling
  return;
}
if (!res.ok || !data?.ok) {
  setUiError(data?.error?.message ?? data?.error ?? `Polling failed (${res.status})`);
  setIsPolling(false);
  pollingAliveRef.current = false;
  return;
}


        const job: OcrJob = data.job;
        setActiveJob(job);

        setJobs((prev) => {
          const copy = [...prev];
          const idx = copy.findIndex((j) => j.job_id === job.job_id);
          if (idx >= 0) copy[idx] = job;
          else copy.unshift(job);
          return copy;
        });

        if (job?.status === "succeeded" || job?.status === "failed") {
          setIsPolling(false);
          pollingAliveRef.current = false;
        }
      } catch (e: any) {
        if (!alive) return;
        setUiError(e?.message ?? String(e));
        setIsPolling(false);
        pollingAliveRef.current = false;
      }
    };

    pollOnce();
    const interval = setInterval(pollOnce, 1500);

    return () => {
      alive = false;
      pollingAliveRef.current = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeDealId, activeJobId]);

  useEffect(() => {
    if (!copyToast) return;
    const t = setTimeout(() => setCopyToast(null), 1400);
    return () => clearTimeout(t);
  }, [copyToast]);

  async function handleUpload(file: File) {
    setUiError(null);
    setBusyUpload(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(`/api/deals/${safeDealId}/upload`, {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error?.message ?? data?.error ?? `Upload failed (${res.status})`);
      }

      await refreshUploads();
      await refreshJobs();
    } catch (e: any) {
      setUiError(e?.message ?? String(e));
    } finally {
      setBusyUpload(false);
    }
  }

  async function handleRunOcr(storedName: string) {
    setUiError(null);
    setBusyOcr(storedName);

    setActiveJob(null);
    setActiveJobId(null);
    setTab("text");
    setTextSearch("");

    try {
      const enqueueRes = await fetch(`/api/deals/${safeDealId}/ocr/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: storedName }),
      });

      const enqueueData = await enqueueRes.json().catch(() => null);
      if (!enqueueRes.ok || !enqueueData?.job_id) {
        throw new Error(
          enqueueData?.error?.message ??
            enqueueData?.error ??
            `Enqueue failed (${enqueueRes.status})`
        );
      }

      const jobId: string = enqueueData.job_id;

      setActiveJobId(jobId);

      const runRes = await fetch(`/api/deals/${safeDealId}/ocr/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      });

      const runData = await runRes.json().catch(() => null);

      if (!runRes.ok || runData?.ok === false) {
        setUiError(runData?.error?.message ?? runData?.error ?? `OCR run failed (${runRes.status})`);
      }

      await refreshJobs();
    } catch (e: any) {
      setUiError(e?.message ?? String(e));
    } finally {
      setBusyOcr(null);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyToast("Copied!");
    } catch {
      setCopyToast("Copy failed");
    }
  }

  const activeJobDisplay = activeJob ?? null;
  const activeResult = activeJobDisplay?.result ?? null;

  const classification: Classification | null = activeResult?.classification ?? null;

  const textPreview: string = String(activeResult?.text_preview ?? "");
  const rawJsonObj = activeResult?.raw ?? null;
  const rawJsonStr = rawJsonObj ? safeJson(rawJsonObj) : "";
  const tables = rawJsonObj ? extractTables(rawJsonObj) : [];
  const tablesCsv = useMemo(() => tablesToCsv(tables), [tables]);
    const moodyPkg = useMemo(() => {
    const c4 = activeResult?.c4 ?? null;
    if (!c4) return null;
    try {
      return buildMoodyPnlPackageFromC4({ dealId, jobId: activeJobDisplay?.job_id ?? "unknown", c4 });

    } catch {
      return null;
    }
  }, [dealId, activeJobDisplay?.job_id, activeResult?.c4]);



  const filteredText = useMemo(() => {
    const q = textSearch.trim();
    if (!q) return textPreview;
    const lines = textPreview.split("\n");
    const qLower = q.toLowerCase();
    const kept = lines.filter((l) => l.toLowerCase().includes(qLower));
    return kept.join("\n");
  }, [textPreview, textSearch]);

  const exportBaseName = useMemo(() => {
    if (!activeJobDisplay) return "ocr_export";
    const fileLabel = sanitizeFilenamePart(
      activeJobDisplay.stored_name ?? activeJobDisplay.file_name ?? "document"
    );
    const jobLabel = sanitizeFilenamePart(activeJobDisplay.job_id ?? "job");
    return `${fileLabel}__${jobLabel}`;
  }, [activeJobDisplay]);

  function handleDownloadRawJson() {
    downloadFile(`${exportBaseName}.json`, rawJsonStr || "{}", "application/json;charset=utf-8");
  }

  function handleDownloadBundleJson() {
    const bundle = {
      deal_id: dealId,
      job: {
        job_id: activeJobDisplay?.job_id,
        status: activeJobDisplay?.status,
        created_at: activeJobDisplay?.created_at,
        updated_at: activeJobDisplay?.updated_at,
        stored_name: activeJobDisplay?.stored_name ?? activeJobDisplay?.file_name ?? null,
      },
      ocr: {
        engine: activeResult?.engine ?? null,
        model: activeResult?.model ?? null,
        pages_estimate: activeResult?.pages_estimate ?? null,
        elapsed_ms: activeResult?.elapsed_ms ?? null,
      },
      classification: classification,
      text_preview: textPreview,
      tables_csv: tablesCsv,
      raw: rawJsonObj,
    };

    downloadFile(
      `${exportBaseName}__bundle.json`,
      safeJson(bundle),
      "application/json;charset=utf-8"
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Left */}
      <div className="rounded-lg border p-4">
        <div className="mb-2 text-lg font-semibold">Document Uploads</div>
        <div className="mb-4 text-sm text-gray-600">
          Upload tax returns, PFS, financials, leases.
        </div>

        {uiError && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {uiError}
          </div>
        )}

        <div className="rounded border border-dashed p-4">
          <div className="text-sm font-medium">Upload PDF or image</div>
          <div className="mt-1 text-xs text-gray-500">
            Files are stored in Codespace (v1). Next: Azure Document Intelligence.
          </div>

          <div className="mt-3 flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded bg-black px-3 py-2 text-sm text-white">
              <input
                type="file"
                className="hidden"
                accept=".pdf,image/*"
                disabled={busyUpload}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  e.currentTarget.value = "";
                }}
              />
              {busyUpload ? "Uploading..." : "Choose File"}
            </label>
          </div>
        </div>

        <div className="mt-4 rounded border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold">Uploaded Files</div>
            <button className="text-sm underline" onClick={refreshUploads} type="button">
              Refresh
            </button>
          </div>

          {uploads.length === 0 ? (
            <div className="text-sm text-gray-600">No files uploaded yet.</div>
          ) : (
            <div className="space-y-2">
              {uploads.map((u, idx) => (
                <div
                  key={`${u.file_id ?? u.stored_name ?? "upload"}-${idx}`}
                  className="flex items-center justify-between rounded border p-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {u.stored_name ?? "(missing name)"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {humanBytes(u.size)}{" "}
                      {u.created_at ? `• ${new Date(u.created_at).toLocaleString()}` : ""}
                    </div>
                  </div>

                  <button
                    className="ml-3 rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
                    disabled={!!busyOcr || !u.stored_name}
                    onClick={() => u.stored_name && handleRunOcr(u.stored_name)}
                    type="button"
                  >
                    {busyOcr === u.stored_name ? "Starting..." : "Run OCR"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 rounded border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold">OCR Jobs</div>
            <button className="text-sm underline" onClick={refreshJobs} type="button">
              Refresh
            </button>
          </div>

          {jobs.length === 0 ? (
            <div className="text-sm text-gray-600">
              No OCR jobs yet. Click <b>Run OCR</b> on an uploaded file.
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.slice(0, 10).map((j) => {
                const c: Classification | null = j?.result?.classification ?? null;
                return (
                  <button
                    key={j.job_id}
                    type="button"
                    className="w-full rounded border p-2 text-left hover:bg-gray-50"
                    onClick={() => setActiveJobId(j.job_id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {j.stored_name ?? j.file_name ?? "file"}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(j.created_at).toLocaleString()}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="text-xs text-gray-500">{j.status}</div>
                        {c && (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Badge>{prettyDocType(c.doc_type)}</Badge>
                            <Badge>{c.confidence}%</Badge>
                            {c.tax_year && <Badge>{c.tax_year}</Badge>}
                            {c.pack ? <Badge>Pack</Badge> : null}
                            {c.issuer_hint ? <Badge>{c.issuer_hint}</Badge> : null}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right */}
      <div className="rounded-lg border p-4">
        <div className="mb-2 text-lg font-semibold">Extraction Results</div>
        <div className="mb-4 text-sm text-gray-600">OCR output, tables, and raw JSON.</div>

        {copyToast && <div className="mb-3 rounded border bg-white p-2 text-sm">{copyToast}</div>}

        {!activeJobDisplay ? (
          <div className="rounded border p-3 text-sm text-gray-600">No results yet.</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <div className="font-semibold">Status</div>
                  <div className="text-gray-700">
                    {activeJobDisplay.status}
                    {isPolling && activeJobId === activeJobDisplay.job_id ? " (polling…)" : ""}
                  </div>

                  {classification && (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Badge>{prettyDocType(classification.doc_type)}</Badge>
                        <Badge>{classification.confidence}%</Badge>
                        {classification.tax_year && <Badge>{classification.tax_year}</Badge>}
                        {classification.pack ? <Badge>Tax Pack</Badge> : null}
                        {classification.issuer_hint ? <Badge>{classification.issuer_hint}</Badge> : null}
                        {(classification.tags || []).slice(0, 4).map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                      </div>

                      {classification.subtypes?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {classification.subtypes.slice(0, 8).map((s) => (
                            <Badge key={s}>{prettySubtype(s)}</Badge>
                          ))}
                        </div>
                      ) : null}

                                            {classification.borrower ? (
                        <BorrowerWowCard borrower={classification.borrower} />
                      ) : null}

                      {/* Moody-style spread (P&L v1) */}
                      {moodyPkg ? <MoodyPnlSpreadCard pkg={moodyPkg} /> : null}

                      {classification.doc_type === "FINANCIAL_STATEMENT" && tables.length > 0 ? (
                        <FinancialStatementWowCard c4={activeResult?.c4 ?? null} />
                      ) : null}

                    </div>
                  )}

                  {classification?.reasons?.length ? (
                    <div className="mt-2 text-xs text-gray-500">
                      <div className="font-medium">Why:</div>
                      <ul className="list-disc pl-4">
                        {classification.reasons.slice(0, 6).map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div className="text-right text-xs text-gray-500">
                  <div>Updated {new Date(activeJobDisplay.updated_at).toLocaleString()}</div>
                  {activeResult?.engine && (
                    <div>
                      Engine: <span className="font-medium">{String(activeResult.engine)}</span>
                    </div>
                  )}
                  {activeResult?.model && (
                    <div>
                      Model: <span className="font-medium">{String(activeResult.model)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                disabled={!textPreview}
                onClick={() =>
                  downloadFile(`${exportBaseName}.txt`, textPreview || "", "text/plain;charset=utf-8")
                }
              >
                Download Text (.txt)
              </button>

              <button
                type="button"
                className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                disabled={!tablesCsv}
                onClick={() =>
                  downloadFile(
                    `${exportBaseName}__tables.csv`,
                    tablesCsv || "",
                    "text/csv;charset=utf-8"
                  )
                }
              >
                Download Tables (.csv)
              </button>

              <button
                type="button"
                className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                disabled={!rawJsonStr}
                onClick={handleDownloadRawJson}
              >
                Download Raw (.json)
              </button>

              <button
                type="button"
                className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
                disabled={!textPreview && !rawJsonStr && !tablesCsv}
                onClick={handleDownloadBundleJson}
              >
                Export Bundle (.json)
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex rounded border">
                <button
                  type="button"
                  className={`px-3 py-2 text-sm ${
                    tab === "text" ? "bg-black text-white" : "hover:bg-gray-50"
                  }`}
                  onClick={() => setTab("text")}
                >
                  Text
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm ${
                    tab === "tables" ? "bg-black text-white" : "hover:bg-gray-50"
                  }`}
                  onClick={() => setTab("tables")}
                >
                  Tables
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm ${
                    tab === "raw" ? "bg-black text-white" : "hover:bg-gray-50"
                  }`}
                  onClick={() => setTab("raw")}
                >
                  Raw JSON
                </button>
              </div>

              <div className="flex items-center gap-2">
                {tab === "text" && (
                  <button
                    type="button"
                    className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                    disabled={!textPreview}
                    onClick={() => copyToClipboard(textPreview)}
                  >
                    Copy Text
                  </button>
                )}
                {tab === "raw" && (
                  <button
                    type="button"
                    className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                    disabled={!rawJsonStr}
                    onClick={() => copyToClipboard(rawJsonStr)}
                  >
                    Copy JSON
                  </button>
                )}
              </div>
            </div>

            {tab === "text" && (
              <div className="rounded border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold">OCR Text</div>
                  <input
                    value={textSearch}
                    onChange={(e) => setTextSearch(e.target.value)}
                    placeholder="Search text…"
                    className="w-full max-w-xs rounded border px-2 py-1 text-sm"
                  />
                </div>

                <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap text-sm">
                  {textSearch.trim() ? highlightText(filteredText, textSearch) : textPreview}
                </pre>
              </div>
            )}

            {tab === "tables" && (
              <div className="rounded border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold">Detected Tables</div>
                  <div className="text-xs text-gray-500">
                    {tables.length} table{tables.length === 1 ? "" : "s"}
                  </div>
                </div>

                {tables.length === 0 ? (
                  <div className="text-sm text-gray-600">No tables detected in this document.</div>
                ) : (
                  <div className="space-y-4">
                    {tables.slice(0, 10).map((t, idx) => {
                      const grid = tableToGrid(t);
                      return (
                        <div key={idx} className="rounded border p-2">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-sm font-medium">Table {idx + 1}</div>
                            <div className="text-xs text-gray-500">
                              {grid.rowCount}×{grid.colCount}
                            </div>
                          </div>

                          <div className="max-h-[320px] overflow-auto">
                            <table className="w-full border-collapse text-sm">
                              <tbody>
                                {grid.rows.map((row, rIdx) => (
                                  <tr key={rIdx}>
                                    {row.map((cell, cIdx) => (
                                      <td key={cIdx} className="border px-2 py-1 align-top">
                                        {cell}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === "raw" && (
              <div className="rounded border p-3">
                {!rawJsonStr ? (
                  <div className="text-sm text-gray-600">No raw JSON available.</div>
                ) : (
                  <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap text-xs">
                    {rawJsonStr}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
