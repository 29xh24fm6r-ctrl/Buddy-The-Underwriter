"use client";

import * as React from "react";

type Thread = {
  dealId: string;
  dealName: string | null;
  borrowerName: string | null;

  displayLabel: string;
  displaySubtitle: string | null;

  lastMessageAt: string | null;
  lastMessageBody: string;
  lastSenderRole: string | null;
  lastSenderDisplay: string | null;

  unreadBorrowerCount: number;
};

type DealMessage = {
  id: string;
  deal_id: string;
  sender_role: "banker" | "borrower";
  sender_display: string | null;
  body: string;
  created_at: string;
};

function shortDealId(id: string) {
  return `${id.slice(0, 8)}…`;
}

export function BankerMessagesInbox(props: { bankerUserId: string }) {
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [activeDealId, setActiveDealId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<DealMessage[]>([]);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function loadThreads() {
    setError(null);
    const res = await fetch(`/api/banker/messages/inbox?limit=50`, {
      method: "GET",
      headers: { "x-user-id": props.bankerUserId },
    });
    const json = await res.json();
    if (!json?.ok) {
      setError(json?.error ?? "Failed to load inbox");
      return;
    }
    setThreads(json.threads ?? []);
  }

  async function loadMessages(dealId: string) {
    setError(null);
    const res = await fetch(`/api/deals/${dealId}/messages`, {
      method: "GET",
      headers: { "x-user-id": props.bankerUserId },
    });
    const json = await res.json();
    if (!json?.ok) {
      setError(json?.error ?? "Failed to load messages");
      return;
    }
    setMessages(json.messages ?? []);

    // mark read
    await fetch(`/api/banker/messages/mark-read`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": props.bankerUserId },
      body: JSON.stringify({ dealId }),
    }).catch(() => null);

    await loadThreads();
  }

  React.useEffect(() => {
    loadThreads();
    const t = window.setInterval(loadThreads, 12000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openThread(dealId: string) {
    setActiveDealId(dealId);
    await loadMessages(dealId);
  }

  async function send() {
    if (!activeDealId) return;
    const body = text.trim();
    if (!body) return;

    setError(null);
    setText("");

    const res = await fetch(`/api/deals/${activeDealId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": props.bankerUserId },
      body: JSON.stringify({ body, senderDisplay: "Banker" }),
    });
    const json = await res.json();
    if (!json?.ok) {
      setError(json?.error ?? "Send failed");
      return;
    }

    await loadMessages(activeDealId);
    await loadThreads();
  }

  const activeThread = activeDealId ? threads.find((t) => t.dealId === activeDealId) : null;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {/* Left: inbox */}
      <div className="rounded-xl border bg-white p-3">
        <div className="text-sm font-semibold">Messages</div>
        <div className="mt-2 space-y-2">
          {threads.length ? (
            threads.map((t) => (
              <button
                key={t.dealId}
                onClick={() => openThread(t.dealId)}
                className={[
                  "w-full rounded-lg border p-3 text-left hover:bg-gray-50",
                  activeDealId === t.dealId ? "bg-gray-50" : "bg-white",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{t.displayLabel}</div>
                    {t.displaySubtitle && (
                      <div className="truncate text-xs text-gray-600">{t.displaySubtitle}</div>
                    )}
                  </div>

                  {t.unreadBorrowerCount ? (
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold">
                      {t.unreadBorrowerCount}
                    </span>
                  ) : null}
                </div>

                <div className="mt-1 text-xs text-gray-500">
                  {t.lastMessageAt ? new Date(t.lastMessageAt).toLocaleString() : "—"}
                </div>
                <div className="mt-1 line-clamp-2 text-sm text-gray-700">{t.lastMessageBody}</div>
              </button>
            ))
          ) : (
            <div className="text-sm text-gray-600">No message threads yet.</div>
          )}
        </div>
      </div>

      {/* Right: thread */}
      <div className="md:col-span-2 rounded-xl border bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {activeThread ? activeThread.displayLabel : "Select a thread"}
            </div>
            {activeThread?.displaySubtitle && (
              <div className="truncate text-xs text-gray-600">{activeThread.displaySubtitle}</div>
            )}
          </div>

          <button
            className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
            onClick={() => activeDealId && loadMessages(activeDealId)}
            disabled={!activeDealId}
          >
            Refresh
          </button>
        </div>

        <div className="mt-3 h-[360px] overflow-auto rounded-lg border bg-gray-50 p-3">
          {activeDealId ? (
            messages.length ? (
              <div className="space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_role === "banker" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[80%] rounded-lg border bg-white p-2 text-sm">
                      <div className="text-xs text-gray-500">
                        {m.sender_display ?? (m.sender_role === "banker" ? "Bank" : "Borrower")} •{" "}
                        {new Date(m.created_at).toLocaleString()}
                      </div>
                      <div className="mt-1 text-gray-800">{m.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-600">No messages in this thread yet.</div>
            )
          ) : (
            <div className="text-sm text-gray-600">Choose a deal thread from the left.</div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="h-10 flex-1 rounded-md border px-3 text-sm"
            placeholder="Write a message to the borrower…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!activeDealId}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <button
            className="h-10 rounded-md border px-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            onClick={send}
            disabled={!activeDealId}
          >
            Send
          </button>
        </div>

        {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}
      </div>
    </div>
  );
}
