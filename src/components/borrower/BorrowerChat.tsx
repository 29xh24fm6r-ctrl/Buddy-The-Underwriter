"use client";

import * as React from "react";

type DealMessage = {
  id: string;
  deal_id: string;
  sender_role: "banker" | "borrower";
  sender_display: string | null;
  body: string;
  created_at: string;
};

export function BorrowerChat(props: { dealId: string }) {
  const [messages, setMessages] = React.useState<DealMessage[]>([]);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  async function load() {
    setError(null);
    const res = await fetch(`/api/deals/${props.dealId}/chat`, { method: "GET" });
    const json = await res.json();
    if (!json?.ok) {
      setError(json?.error ?? "Failed to load messages");
      return;
    }
    setMessages(json.messages ?? []);
  }

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dealId]);

  async function send() {
    const body = text.trim();
    if (!body) return;

    setSending(true);
    setError(null);

    try {
      const res = await fetch(`/api/deals/${props.dealId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, senderDisplay: "Borrower" }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Send failed");

      setText("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold">Messages</div>
        <div className="text-xs text-gray-500">Chat with your banker</div>
      </div>

      <div className="mt-3 h-[280px] overflow-auto rounded-lg border bg-gray-50 p-3">
        {messages.length ? (
          <div className="space-y-2">
            {messages.map((m) => {
              const mine = m.sender_role === "borrower";
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[80%] rounded-lg border bg-white p-2 text-sm">
                    <div className="text-xs text-gray-500">
                      {m.sender_display ?? (m.sender_role === "banker" ? "Bank" : "You")} •{" "}
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                    <div className="mt-1 text-gray-800">{m.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-600">No messages yet. Send a note to your banker.</div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="h-10 flex-1 rounded-md border px-3 text-sm"
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button
          className="h-10 rounded-md border px-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          onClick={send}
          disabled={sending}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
