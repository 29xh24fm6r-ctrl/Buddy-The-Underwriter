"use client";

import { useEffect, useState } from "react";

type Condition = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "satisfied" | "waived" | "rejected";
  source: string;
  source_key: string | null;
  required_docs: Array<{ key: string; label: string; optional?: boolean }>;
  due_date: string | null;
  borrower_message_subject: string | null;
  borrower_message_body: string | null;
  reminder_subscription_id: string | null;
};

export default function ConditionsToCloseCard({ dealId }: { dealId: string }) {
  const [items, setItems] = useState<Condition[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/conditions/list`, { method: "GET" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setErr(json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ""}` : `http_${res.status}`);
      return;
    }
    setItems(json.items || []);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/conditions/generate-from-mitigants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setErr(json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ""}` : `http_${res.status}`);
        return;
      }
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "generate_failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(condition_id: string, status: Condition["status"]) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/conditions/set-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition_id, status }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setErr(json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ""}` : `http_${res.status}`);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }

  const open = items.filter((i) => i.status === "open").length;
  const done = items.filter((i) => i.status === "satisfied").length;

  return (
    <div className="rounded-2xl border p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Conditions to Close</div>
          <div className="text-xs text-muted-foreground mt-1">
            Generated from policy mitigants. Includes borrower message drafts + reminders.
          </div>
        </div>

        <button
          onClick={generate}
          disabled={busy}
          className="rounded-xl border px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Generating…" : "Generate from Mitigants"}
        </button>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {err}
        </div>
      ) : null}

      <div className="flex gap-2 text-xs">
        <span className="rounded-full border px-2 py-1 font-semibold">Open: {open}</span>
        <span className="rounded-full border px-2 py-1 font-semibold">Satisfied: {done}</span>
        <span className="rounded-full border px-2 py-1 font-semibold">Total: {items.length}</span>
      </div>

      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No conditions yet. Generate from mitigants.</div>
        ) : (
          items.map((c) => (
            <div key={c.id} className="rounded-xl border p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{c.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Status: <span className="font-semibold">{c.status.toUpperCase()}</span>
                    {c.due_date ? ` · Due: ${new Date(c.due_date).toLocaleDateString()}` : ""}
                    {c.reminder_subscription_id ? " · Reminders: ON" : ""}
                  </div>
                  {c.description ? <div className="text-sm text-muted-foreground mt-2">{c.description}</div> : null}
                </div>

                <div className="flex flex-col gap-2">
                  {c.status !== "satisfied" ? (
                    <button
                      onClick={() => setStatus(c.id, "satisfied")}
                      className="rounded-lg border px-3 py-2 text-xs font-semibold"
                    >
                      Mark satisfied
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(c.id, "open")}
                      className="rounded-lg border px-3 py-2 text-xs font-semibold"
                    >
                      Re-open
                    </button>
                  )}

                  {c.status !== "waived" ? (
                    <button
                      onClick={() => setStatus(c.id, "waived")}
                      className="rounded-lg border px-3 py-2 text-xs font-semibold"
                    >
                      Waive
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(c.id, "open")}
                      className="rounded-lg border px-3 py-2 text-xs font-semibold"
                    >
                      Un-waive
                    </button>
                  )}
                </div>
              </div>

              {Array.isArray(c.required_docs) && c.required_docs.length ? (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">Required documents</div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {c.required_docs.map((d) => (
                      <li key={d.key} className="flex gap-2">
                        <span className="text-muted-foreground">•</span>
                        <span>
                          <span className="font-semibold">{d.label}</span>
                          {d.optional ? <span className="text-muted-foreground"> (optional)</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {c.borrower_message_subject || c.borrower_message_body ? (
                <div className="rounded-xl border p-3">
                  <div className="text-xs font-semibold text-muted-foreground">Borrower message draft</div>
                  <div className="mt-2 text-sm">
                    <div className="font-semibold">{c.borrower_message_subject || "Subject"}</div>
                    <div className="text-muted-foreground mt-1 whitespace-pre-wrap">{c.borrower_message_body || ""}</div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() =>
                        copy(`Subject: ${c.borrower_message_subject || ""}\n\n${c.borrower_message_body || ""}`)
                      }
                      className="rounded-lg border px-3 py-2 text-xs font-semibold"
                    >
                      Copy message
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
