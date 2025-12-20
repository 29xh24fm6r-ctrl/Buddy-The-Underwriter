"use client";

import * as React from "react";

type Message = {
  id: string;
  sender_role: "borrower" | "banker";
  sender_display: string;
  body: string;
  created_at: string;
};

export function PortalChatCard({ dealId, bankerUserId }: { dealId: string; bankerUserId: string }) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [text, setText] = React.useState("");
  const [senderDisplay, setSenderDisplay] = React.useState("Bank Team");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/banker/deals/${dealId}/portal-chat`, {
        method: "GET",
        headers: { "x-user-id": bankerUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load");
      setMessages(json.messages ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 6000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, bankerUserId]);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText("");

    const res = await fetch(`/api/banker/deals/${dealId}/portal-chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": bankerUserId },
      body: JSON.stringify({ body, senderDisplay }),
    });
    const json = await res.json();
    if (!json?.ok) setError(json?.error ?? "Send failed");
    await load();
  }

  return (
    <div className="rounded-xl border bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Borrower chat</div>
          <div className="mt-1 text-sm text-gray-600">Messages visible to borrower in portal</div>
        </div>
        <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

      <div ref={scrollRef} className="mt-3 max-h-96 space-y-2 overflow-auto rounded-xl border bg-gray-50 p-3">
        {loading ? (
          <div className="text-sm text-gray-600">Loading messages…</div>
        ) : messages.length ? (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border p-3 ${
                m.sender_role === "borrower" ? "bg-blue-50" : "bg-white"
              }`}
            >
              <div className="text-xs text-gray-500">
                {m.sender_display} • {new Date(m.created_at).toLocaleString()}
              </div>
              <div className="mt-1 text-sm text-gray-800">{m.body}</div>
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-600">No messages yet</div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <input
          className="h-9 w-full rounded-md border px-3 text-sm"
          value={senderDisplay}
          onChange={(e) => setSenderDisplay(e.target.value)}
          placeholder="Display name (e.g., Bank Team)"
        />
        <div className="flex gap-2">
          <textarea
            className="min-h-20 w-full rounded-md border px-3 py-2 text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message to borrower…"
          />
          <button
            className="h-20 rounded-md border bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800"
            onClick={send}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
