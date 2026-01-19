"use client";

import { useEffect, useMemo, useState } from "react";

type PortalPayload = {
  invite: { id: string; dealId: string; name: string | null; email: string | null; expiresAt: string };
  deal: any;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    required: boolean;
    status: "missing" | "received" | "review" | "partial";
    group: string;
    checklistKey: string;
    progress?: { satisfied: number; required: number } | null;
  }>;
  requests: any[];
  messages: any[];
};

export default function BorrowerPortalClient({ token }: { token: string }) {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const [uploadStatuses, setUploadStatuses] = useState<Record<string, {
    status: "received" | "analyzing" | "matched" | "clarify";
    detail: string;
  }>>({});

  const tasks = useMemo(() => data?.tasks || [], [data?.tasks]);
  const groupedTasks = useMemo(() => {
    const groups: Record<string, typeof tasks> = {};
    tasks.forEach((t) => {
      if (!groups[t.group]) groups[t.group] = [];
      groups[t.group].push(t);
    });
    return Object.entries(groups).map(([group, items]) => ({
      group,
      items: items.sort((a, b) => {
        if (a.required !== b.required) return a.required ? -1 : 1;
        return a.title.localeCompare(b.title);
      }),
    }));
  }, [tasks]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/api/portal/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        if (!alive) return;
        setData(json);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load portal");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  async function prepareUpload(requestId: string | null, file: File) {
    const res = await fetch("/api/portal/upload/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, requestId, filename: file.name, mimeType: file.type }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to prepare upload");
    return json as { signedUrl: string; path: string; bucket: string; token: string };
  }

  async function doUpload(requestId: string | null, file: File, taskKey?: string | null) {
    const statusId = `${taskKey || "extra"}:${file.name}:${Date.now()}`;
    setUploadStatuses((prev) => ({
      ...prev,
      [statusId]: { status: "received", detail: "Received" },
    }));

    const prep = await prepareUpload(requestId, file);

    // PUT to Supabase Storage signed URL
    const put = await fetch(prep.signedUrl, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);

    // commit metadata
    setUploadStatuses((prev) => ({
      ...prev,
      [statusId]: { status: "analyzing", detail: "Analyzing…" },
    }));

    const commit = await fetch("/api/portal/upload/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        requestId,
        taskKey,
        path: prep.path,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      }),
    });
    const cj = await commit.json();
    if (!commit.ok) throw new Error(cj?.error || "Failed to finalize upload");

    const matchedTitle = tasks.find((t) => t.checklistKey === cj?.checklistKey)?.title || null;
    if (cj?.checklistKey || matchedTitle) {
      setUploadStatuses((prev) => ({
        ...prev,
        [statusId]: {
          status: "matched",
          detail: matchedTitle
            ? `Matched to ${matchedTitle}`
            : "Matched to a requested document",
        },
      }));
    } else {
      setUploadStatuses((prev) => ({
        ...prev,
        [statusId]: {
          status: "clarify",
          detail: "We received this, but need clarification",
        },
      }));
    }

    // refresh session
    const res = await fetch("/api/portal/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = await res.json();
    if (res.ok) setData(json);
  }

  async function sendMessage() {
    if (!msg.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/portal/messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, body: msg }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to send");
      setMsg("");
      // refresh
      const r2 = await fetch("/api/portal/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j2 = await r2.json();
      if (r2.ok) setData(j2);
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="p-8 text-slate-700">Loading portal…</div>;
  if (err) return <div className="p-8 text-red-700">Portal error: {err}</div>;
  if (!data) return <div className="p-8 text-slate-700">No data.</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xl font-semibold text-slate-900">
            {data.deal?.name || "Your loan"}
          </div>
          <div className="text-sm text-slate-600 mt-1">
            We’re collecting documents to move your loan forward.
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Link expires: {new Date(data.invite.expiresAt).toLocaleString()}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-base font-semibold text-slate-900">Tasks</div>
            <div className="text-sm text-slate-600 mt-1">
              Upload documents below. We’ll match them to the right task automatically.
            </div>

            <div className="mt-4 space-y-4">
              {groupedTasks.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  No tasks yet. Your lending team will add them soon.
                </div>
              ) : (
                groupedTasks.map(({ group, items }) => (
                  <div key={group} className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {group}
                    </div>
                    {items.map((t) => (
                      <div key={t.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{t.title}</div>
                            {t.description ? (
                              <div className="text-xs text-slate-600 mt-1">{t.description}</div>
                            ) : null}
                            <div className="mt-2 text-xs text-slate-500">
                              Status: {t.status === "received" ? "Received" : t.status === "review" ? "Needs review" : t.status === "partial" ? "Partially received" : "Missing"}
                              {t.progress ? ` • ${t.progress.satisfied}/${t.progress.required} years` : ""}
                            </div>
                          </div>
                          <label className="text-xs font-semibold text-slate-700 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50">
                            Upload
                            <input
                              type="file"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                try {
                                  await doUpload(null, file, t.checklistKey);
                                } catch (err: any) {
                                  alert(err?.message || "Upload failed");
                                } finally {
                                  e.target.value = "";
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              Tip: You can also upload extra documents if you&apos;re not sure where they go.
              <div className="mt-2">
                <label className="cursor-pointer inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50">
                  Upload additional info
                  <input
                    type="file"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        await doUpload(null, file, null);
                      } catch (err: any) {
                        alert(err?.message || "Upload failed");
                      } finally {
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            {Object.keys(uploadStatuses).length > 0 ? (
              <div className="mt-4 space-y-2">
                {Object.entries(uploadStatuses).map(([key, status]) => (
                  <div key={key} className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                    <div className="font-semibold">
                      {status.status === "received" ? "✅ Received" : status.status === "analyzing" ? "🧠 Analyzing…" : status.status === "matched" ? "✅ Matched" : "⚠️ Needs clarification"}
                    </div>
                    <div className="mt-1">{status.detail}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-base font-semibold text-slate-900">Messages</div>
            <div className="text-sm text-slate-600 mt-1">
              Ask questions here. Buddy and your underwriter can respond.
            </div>

            <div className="mt-4 space-y-2 max-h-[420px] overflow-auto pr-1">
              {(data.messages || []).length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  No messages yet.
                </div>
              ) : (
                data.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-xl border p-3 ${
                      m.direction === "borrower"
                        ? "border-slate-200 bg-slate-50"
                        : "border-emerald-200 bg-emerald-50"
                    }`}
                  >
                    <div className="text-xs text-slate-600">
                      {m.direction === "borrower" ? "You" : "Lending Team"} •{" "}
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                    <div className="text-sm text-slate-900 mt-1 whitespace-pre-wrap">{m.body}</div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <textarea
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm"
                rows={3}
                placeholder="Type a message…"
              />
            </div>

            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={sending}
                onClick={sendMessage}
                className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              SBA question? Ask here and Buddy can explain SBA 7(a)/504 requirements in plain English.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
