"use client";

import { useEffect, useMemo, useState } from "react";

type UploadRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  request_id: string | null;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_bucket: string;
  storage_path: string;
  uploaded_at: string;
};

type RequestRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

type RankedSuggestion = {
  requestId: string;
  title: string;
  status: string;
  category: string | null;
  confidence: number;
  evidence: {
    hits: string[];
    docType?: string | null;
    year?: number | null;
    source?: string | null;
    keywords?: string[];
  };
};

type RankedSuggestResp = {
  ok: boolean;
  uploadId: string;
  filename: string;
  alreadyAssignedRequestId: string | null;
  suggestions: RankedSuggestion[];
};

function fmtBytes(n?: number | null) {
  if (!n || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function isPdf(mime?: string | null, filename?: string) {
  if (mime?.toLowerCase().includes("pdf")) return true;
  if (filename?.toLowerCase().endsWith(".pdf")) return true;
  return false;
}

function isImage(mime?: string | null, filename?: string) {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return true;
  const f = (filename || "").toLowerCase();
  return f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg") || f.endsWith(".webp");
}

function confLabel(c: number) {
  const pct = Math.round(c * 100);
  if (pct >= 90) return `${pct}% • Very high`;
  if (pct >= 75) return `${pct}% • High`;
  if (pct >= 60) return `${pct}% • Medium`;
  return `${pct}% • Low`;
}

export default function UploadInboxCard({ dealId }: { dealId: string }) {
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  const [note, setNote] = useState("");
  const [actorName, setActorName] = useState("Lending Team");

  const [busyAssign, setBusyAssign] = useState(false);
  const [filter, setFilter] = useState("");

  // Inline preview drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Ranked suggest (NEW)
  const [rankBusy, setRankBusy] = useState(false);
  const [ranked, setRanked] = useState<RankedSuggestResp | null>(null);

  // Create Request modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDueAt, setNewDueAt] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function refresh() {
    setLoading(true);
    try {
      const [uRes, rRes] = await Promise.all([
        fetch(`/api/deals/${dealId}/portal/uploads/unassigned`, { cache: "no-store" }),
        fetch(`/api/deals/${dealId}/portal/requests`, { cache: "no-store" }),
      ]);

      const uj = await uRes.json();
      const rj = await rRes.json();

      if (!uRes.ok) throw new Error(uj?.error || `Uploads HTTP ${uRes.status}`);
      if (!rRes.ok) throw new Error(rj?.error || `Requests HTTP ${rRes.status}`);

      setUploads(uj.uploads || []);
      setRequests(rj.requests || []);
    } catch (e: any) {
      setToast(e?.message || "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const selectedUpload = useMemo(
    () => uploads.find((u) => u.id === selectedUploadId) || null,
    [uploads, selectedUploadId]
  );

  const filteredUploads = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return uploads;
    return uploads.filter((u) => u.original_filename.toLowerCase().includes(q));
  }, [uploads, filter]);

  const requestsSorted = useMemo(() => {
    const rank = (s: string) => {
      if (s === "requested") return 0;
      if (s === "rejected") return 1;
      if (s === "uploaded") return 2;
      if (s === "accepted") return 3;
      return 9;
    };
    return [...requests].sort((a, b) => rank(a.status) - rank(b.status));
  }, [requests]);

  const selectedUploadIsPdf = isPdf(selectedUpload?.mime_type ?? null, selectedUpload?.original_filename);
  const selectedUploadIsImage = isImage(selectedUpload?.mime_type ?? null, selectedUpload?.original_filename);

  async function getPreviewUrl(uploadId: string) {
    const res = await fetch(`/api/deals/${dealId}/portal/uploads/preview-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId, expiresIn: 600 }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    return json.signedUrl as string;
  }

  async function openDrawerPreview(uploadId: string) {
    setDrawerOpen(true);
    setPreviewBusy(true);
    setPreviewUrl(null);
    try {
      const url = await getPreviewUrl(uploadId);
      setPreviewUrl(url);
    } catch (e: any) {
      setToast(e?.message || "Preview failed");
      setDrawerOpen(false);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function loadRanked(uploadId: string) {
    setRankBusy(true);
    setRanked(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/uploads/suggest-ranked`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId, limit: 3 }),
      });
      const json = (await res.json()) as RankedSuggestResp;
      if (!res.ok) throw new Error((json as any)?.error || `HTTP ${res.status}`);
      setRanked(json);

      // If top suggestion is strong, preselect it (still lets user override)
      const top = json.suggestions?.[0];
      if (top?.requestId && top.confidence >= 0.75) {
        setSelectedRequestId(top.requestId);
      }
    } catch (e: any) {
      setToast(e?.message || "Ranked suggest failed");
    } finally {
      setRankBusy(false);
    }
  }

  async function chooseUpload(uploadId: string) {
    setSelectedUploadId(uploadId);
    setSelectedRequestId(null);
    setNote("");
    await loadRanked(uploadId);
  }

  async function assignDirect(requestId: string) {
    if (!selectedUploadId) {
      setToast("Select an upload first.");
      return;
    }

    setBusyAssign(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/uploads/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId: selectedUploadId,
          requestId,
          note: note.trim() || null,
          actorName: actorName.trim() || "Lending Team",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setToast("Assigned successfully.");
      setSelectedUploadId(null);
      setSelectedRequestId(null);
      setRanked(null);
      setDrawerOpen(false);
      setPreviewUrl(null);
      setCreateOpen(false);
      await refresh();
    } catch (e: any) {
      setToast(e?.message || "Assign failed");
    } finally {
      setBusyAssign(false);
    }
  }

  async function assignDropdown() {
    if (!selectedRequestId) return;
    await assignDirect(selectedRequestId);
  }

  function openCreateFromUpload() {
    if (!selectedUpload) {
      setToast("Select an upload first.");
      return;
    }
    setCreateOpen(true);
    setNewTitle(selectedUpload.original_filename.replace(/\.[^.]+$/, ""));
    setNewCategory("other");
    setNewDescription("");
    setNewDueAt("");
  }

  async function createRequestAndAssign() {
    if (!selectedUpload) return;
    if (!newTitle.trim()) {
      setToast("Title is required.");
      return;
    }

    setCreateBusy(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/requests/create-from-upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId: selectedUpload.id,
          title: newTitle.trim(),
          description: newDescription.trim() || null,
          category: newCategory.trim() || null,
          dueAt: newDueAt ? new Date(newDueAt).toISOString() : null,
          actorName: actorName.trim() || "Lending Team",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setToast("Created request and assigned upload.");
      setCreateOpen(false);
      setDrawerOpen(false);
      setPreviewUrl(null);
      setSelectedUploadId(null);
      setSelectedRequestId(null);
      setRanked(null);
      await refresh();
    } catch (e: any) {
      setToast(e?.message || "Create request failed");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">Upload Inbox</div>
          <div className="text-sm text-slate-600">
            Ranked suggestions with one-click assign. Preview inline. Create a new request when needed.
          </div>
        </div>

        <div className="flex items-center gap-2">
          {toast && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {toast}
            </div>
          )}
          <button
            type="button"
            onClick={refresh}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="px-4 pb-4">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Loading…</div>
        ) : uploads.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            No unassigned uploads 🎉
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left */}
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">Unassigned Uploads ({uploads.length})</div>
                <input
                  className="w-52 rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  placeholder="Filter filename…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>

              <div className="mt-3 space-y-2 max-h-[520px] overflow-auto pr-1">
                {filteredUploads.map((u) => {
                  const selected = u.id === selectedUploadId;
                  return (
                    <div
                      key={u.id}
                      className={`rounded-xl border p-3 transition ${
                        selected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <button type="button" onClick={() => chooseUpload(u.id)} className="w-full text-left">
                        <div className="text-sm font-semibold text-slate-900 break-all">{u.original_filename}</div>
                        <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-2">
                          <span>{fmtDate(u.uploaded_at)}</span>
                          {u.size_bytes ? <span>• {fmtBytes(u.size_bytes)}</span> : null}
                          {u.mime_type ? <span>• {u.mime_type}</span> : null}
                        </div>
                      </button>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openDrawerPreview(u.id)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Preview Inline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                Select an upload to see ranked suggestions on the right.
              </div>
            </div>

            {/* Right */}
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-sm font-semibold text-slate-900">Ranked Suggestions</div>
              <div className="text-xs text-slate-600 mt-1">
                One click assigns the upload to the request and marks it uploaded.
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600">Selected upload</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 break-all">
                  {selectedUpload ? selectedUpload.original_filename : "None selected"}
                </div>
                {selectedUpload && (
                  <div className="mt-1 text-xs text-slate-600">
                    {fmtDate(selectedUpload.uploaded_at)}{" "}
                    {selectedUpload.size_bytes ? `• ${fmtBytes(selectedUpload.size_bytes)}` : ""}
                  </div>
                )}

                {selectedUpload && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openDrawerPreview(selectedUpload.id)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Preview Inline
                    </button>
                    <button
                      type="button"
                      onClick={() => loadRanked(selectedUpload.id)}
                      disabled={rankBusy}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {rankBusy ? "Loading…" : "Re-run ranking"}
                    </button>
                    <button
                      type="button"
                      onClick={openCreateFromUpload}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Create Request From Upload
                    </button>
                  </div>
                )}
              </div>

              {/* Ranked list */}
              <div className="mt-3 space-y-2">
                {!selectedUploadId ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    Select an upload to see suggestions.
                  </div>
                ) : rankBusy ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    Ranking suggestions…
                  </div>
                ) : ranked?.suggestions?.length ? (
                  ranked.suggestions.map((s) => (
                    <div key={s.requestId} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">{s.title}</div>
                          <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-2">
                            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                              {confLabel(s.confidence)}
                            </span>
                            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                              {s.status}
                            </span>
                            {s.category ? (
                              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                                {s.category}
                              </span>
                            ) : null}
                          </div>
                          {s.evidence ? (
                            <div className="mt-2 space-y-1">
                              {s.evidence?.hits?.length ? (
                                <div className="text-[11px] text-slate-600">
                                  Evidence: <span className="text-slate-700">{s.evidence.hits.join(", ")}</span>
                                </div>
                              ) : null}

                              {(s.evidence.docType || s.evidence.year) ? (
                                <div className="text-[11px] text-slate-600">
                                  Detected:{" "}
                                  <span className="text-slate-700">
                                    {s.evidence.docType ? String(s.evidence.docType) : "unknown"}
                                    {s.evidence.year ? ` • ${s.evidence.year}` : ""}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex flex-col gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={busyAssign}
                            onClick={() => assignDirect(s.requestId)}
                            className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                          >
                            {busyAssign ? "Assigning…" : "Assign"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedRequestId(s.requestId)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Select
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    No suggestions (or no requests exist yet). Use "Create Request From Upload".
                  </div>
                )}
              </div>

              {/* Fallback dropdown */}
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">Fallback: manual select</div>
                <div className="text-xs text-slate-600 mt-1">
                  Override ranking by selecting any request, then assign.
                </div>

                <div className="mt-2">
                  <select
                    value={selectedRequestId || ""}
                    onChange={(e) => setSelectedRequestId(e.target.value || null)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select a request…</option>
                    {requestsSorted.map((r) => (
                      <option key={r.id} value={r.id}>
                        [{r.status}] {r.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-700 mb-1">Actor name</div>
                    <input
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      value={actorName}
                      onChange={(e) => setActorName(e.target.value)}
                      placeholder="Lending Team"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-700 mb-1">Note (optional)</div>
                    <input
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Why you assigned it this way…"
                    />
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={busyAssign || !selectedUploadId || !selectedRequestId}
                    onClick={assignDropdown}
                    className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {busyAssign ? "Assigning…" : "Assign Upload"}
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                This is deterministic today. Next we can feed OCR/classify outputs into ranking to make it feel psychic.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Preview Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              setDrawerOpen(false);
              setPreviewUrl(null);
            }}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-3xl bg-white shadow-2xl border-l border-slate-200">
            <div className="p-4 flex items-start justify-between gap-2 border-b border-slate-200">
              <div>
                <div className="text-sm font-semibold text-slate-900">Preview</div>
                <div className="text-xs text-slate-600 break-all">{selectedUpload ? selectedUpload.original_filename : ""}</div>
              </div>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setDrawerOpen(false);
                  setPreviewUrl(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="p-4 h-[calc(100%-60px)]">
              {previewBusy ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  Loading preview…
                </div>
              ) : !previewUrl ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">No preview available.</div>
              ) : selectedUploadIsPdf ? (
                <iframe title="PDF Preview" src={previewUrl} className="w-full h-full rounded-xl border border-slate-200" />
              ) : selectedUploadIsImage ? (
                <div className="w-full h-full overflow-auto rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Preview" className="max-w-full max-h-full rounded-lg" />
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  This file type can't be rendered inline.{" "}
                  <a href={previewUrl} target="_blank" rel="noreferrer" className="text-slate-900 font-semibold underline">
                    Open preview
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Request Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setCreateOpen(false)} />
          <div className="absolute inset-x-0 top-16 mx-auto w-full max-w-2xl bg-white shadow-2xl rounded-2xl border border-slate-200">
            <div className="p-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <div className="text-base font-semibold text-slate-900">Create Request From Upload</div>
                <div className="text-xs text-slate-600 mt-1">
                  Creates a new borrower request and assigns the selected upload immediately.
                </div>
              </div>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setCreateOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Title</div>
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">Category</div>
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="condition / mitigant / financials / tax / other"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">Due date (optional)</div>
                  <input type="datetime-local" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" value={newDueAt} onChange={(e) => setNewDueAt(e.target.value)} />
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Description (optional)</div>
                <textarea className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" rows={3} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={createBusy || !newTitle.trim()}
                  onClick={createRequestAndAssign}
                  className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {createBusy ? "Creating…" : "Create & Assign"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
