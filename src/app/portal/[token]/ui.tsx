"use client";

import { useEffect, useMemo, useState } from "react";

type PortalPayload = {
  invite: { id: string; dealId: string; name: string | null; email: string | null; expiresAt: string };
  deal: any;
  requests: any[];
  messages: any[];
};

export default function BorrowerPortalClient({ token }: { token: string }) {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const openRequests = useMemo(() => (data?.requests || []).filter(r => r.status !== "accepted"), [data]);

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

  async function doUpload(requestId: string | null, file: File) {
    const prep = await prepareUpload(requestId, file);

    // PUT to Supabase Storage signed URL
    const put = await fetch(prep.signedUrl, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);

    // commit metadata
    const commit = await fetch("/api/portal/upload/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        requestId,
        path: prep.path,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      }),
    });
    const cj = await commit.json();
    if (!commit.ok) throw new Error(cj?.error || "Failed to finalize upload");

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
          <div className="text-xl font-semibold text-slate-900">Borrower Portal</div>
          <div className="text-sm text-slate-600 mt-1">
            Upload requested documents and message your lending team.
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Link expires: {new Date(data.invite.expiresAt).toLocaleString()}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-base font-semibold text-slate-900">Requested Documents</div>
            <div className="text-sm text-slate-600 mt-1">
              Upload files next to each request. Buddy will sort them automatically.
            </div>

            <div className="mt-4 space-y-3">
              {openRequests.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  Nothing requested right now.
                </div>
              ) : (
                openRequests.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="text-sm font-semibold text-slate-900">{r.title}</div>
                    {r.description && <div className="text-xs text-slate-600 mt-1">{r.description}</div>}
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="text-xs text-slate-500">Status: {r.status}</div>
                      <label className="text-xs font-semibold text-slate-700 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50">
                        Upload
                        <input
                          type="file"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              await doUpload(r.id, file);
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
                ))
              )}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              Tip: You can also upload "extra docs" if you&apos;re not sure where they go.
              <div className="mt-2">
                <label className="cursor-pointer inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50">
                  Upload extra docs
                  <input
                    type="file"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        await doUpload(null, file);
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
