"use client";

import * as React from "react";
import { ToastProvider, useToast } from "@/components/portal/toast/ToastProvider";
import { ConfettiBurst } from "@/components/portal/fun/ConfettiBurst";
import { BuddyCoachCard } from "@/components/portal/BuddyCoachCard";

type Guided = {
  ok: boolean;
  display: { dealName: string; borrowerName: string };
  status: { stage: string; etaText: string | null };
  progress: { requiredTotal: number; requiredDone: number; percent: number };
  checklist: Array<{
    id: string;
    code: string;
    title: string;
    description: string | null;
    group: string;
    required: boolean;
    sort: number;
    status: "missing" | "received" | "verified";
    completedAt: string | null;
  }>;
  receipts: Array<{ id: string; filename: string; received_at: string; uploader_role: string }>;
};

function moodLine(pct: number) {
  if (pct >= 100) return "You're all set 🎉 This is the finish line moment.";
  if (pct >= 70) return "You're crushing it. Just a few more and we're done.";
  if (pct >= 35) return "Great start. We'll make this super easy step-by-step.";
  return "No stress — we'll walk through everything together.";
}

function statusPill(status: string) {
  if (status === "verified") return "Verified ✅";
  if (status === "received") return "Received ✅";
  return "Missing";
}

export default async function GuidedBorrowerUploadPageShell({ params }: any) {
  return (
    <ToastProvider>
      <GuidedBorrowerUploadPage params={params} />
    </ToastProvider>
  );
}

function GuidedBorrowerUploadPage({ params }: any) {
  const [unwrappedParams, setUnwrappedParams] = React.useState<{ dealId: string } | null>(null);
  const { toast } = useToast();
  const [data, setData] = React.useState<Guided | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Celebration triggers
  const [burst, setBurst] = React.useState(false);
  const prevPercentRef = React.useRef<number>(-1);
  const prevReceivedSetRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    Promise.resolve(params).then(setUnwrappedParams);
  }, [params]);

  async function load() {
    if (!unwrappedParams?.dealId) return;
    setError(null);
    setLoading(true);
    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${unwrappedParams.dealId}/guided`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load");
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!unwrappedParams?.dealId) return;
    load();
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unwrappedParams?.dealId]);

  // Micro celebrations when data updates
  React.useEffect(() => {
    if (!data) return;

    // 1) Progress toast
    const pct = data.progress.percent ?? 0;
    const prevPct = prevPercentRef.current;
    if (prevPct >= 0 && pct > prevPct) {
      toast({
        title: "Nice! You leveled up ✅",
        detail: `Progress is now ${pct}%.`,
      });
    }

    // 2) Checklist item flips to received
    const receivedNow = new Set(
      (data.checklist ?? [])
        .filter((i) => i.required && (i.status === "received" || i.status === "verified"))
        .map((i) => i.id)
    );

    const prevSet = prevReceivedSetRef.current;
    const newlyReceived = Array.from(receivedNow).filter((id) => !prevSet.has(id));
    if (newlyReceived.length) {
      setBurst(true);
      window.setTimeout(() => setBurst(false), 50);

      const item = data.checklist.find((x) => x.id === newlyReceived[0]);
      toast({
        title: "Document matched to checklist ✅",
        detail: item ? `Checked off: ${item.title}` : "Checklist updated.",
      });
    }

    // 3) Finish line celebration
    if (prevPct < 100 && pct >= 100) {
      setBurst(true);
      window.setTimeout(() => setBurst(false), 50);
      toast({
        title: "You're done 🎉",
        detail: "We've received everything required. We'll take it from here.",
      });
    }

    prevPercentRef.current = pct;
    prevReceivedSetRef.current = receivedNow;
  }, [data, toast]);

  if (!unwrappedParams) {
    return <div className="p-6 text-sm text-gray-600">Loading…</div>;
  }

  if (loading && !data) {
    return <div className="p-6 text-sm text-gray-600">Loading your checklist…</div>;
  }

  if (error) {
    return <div className="p-6 text-sm text-red-700">Error: {error}</div>;
  }

  if (!data) return null;

  const pct = data.progress.percent;
  const missing = data.checklist.filter((i) => i.required && i.status === "missing");

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <ConfettiBurst fire={burst} />

      {/* Header: calm + personal */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-500">Borrower Portal</div>
            <div className="mt-1 text-lg font-semibold">
              {data.display.dealName} • {data.display.borrowerName}
            </div>
            <div className="mt-1 text-sm text-gray-600">
              Stage: <span className="font-medium">{data.status.stage}</span>
              {data.status.etaText ? (
                <>
                  {" "}
                  • Estimated: <span className="font-medium">{data.status.etaText}</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border bg-gray-50 px-4 py-3">
            <div className="text-xs text-gray-500">Progress</div>
            <div className="mt-1 text-sm font-semibold">
              {data.progress.requiredDone} / {data.progress.requiredTotal} complete
            </div>
            <div className="mt-2 h-2 w-52 overflow-hidden rounded-full bg-gray-200">
              <div className="h-2 rounded-full bg-gray-900" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 text-xs text-gray-600">{moodLine(pct)}</div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        {/* Left: live checklist */}
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Your checklist</div>
              <div className="mt-1 text-sm text-gray-600">
                Upload what you have — we'll handle the rest. You don't need to "know credit."
              </div>
            </div>
            <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" onClick={load}>
              Refresh
            </button>
          </div>

          {missing.length ? (
            <div className="mt-4 rounded-xl border bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">Next best upload</div>
              <div className="mt-1 text-sm text-amber-900">
                Fastest next step: upload <span className="font-semibold">{missing[0].title}</span>.
              </div>
              <div className="mt-2 text-xs text-amber-900/80">
                Don't have it? Tap "I can't find it" in Buddy — we'll find an alternative.
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border bg-green-50 p-4">
              <div className="text-sm font-semibold text-green-800">You're done 🎉</div>
              <div className="mt-1 text-sm text-green-800">
                Everything required has been received. If we need anything else, we'll message you here.
              </div>
            </div>
          )}

          <div className="mt-4 space-y-2">
            {data.checklist.map((i) => (
              <div key={i.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{i.title}</div>
                    {i.description ? <div className="mt-1 text-sm text-gray-600">{i.description}</div> : null}
                    <div className="mt-2 text-xs text-gray-500">{i.required ? "Required" : "Optional"}</div>
                  </div>
                  <span className="shrink-0 rounded-full border bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700">
                    {statusPill(i.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Upload instructions placeholder (hook into your existing upload component) */}
          <div className="mt-4 rounded-xl border bg-gray-50 p-4">
            <div className="text-sm font-semibold">Upload files</div>
            <div className="mt-1 text-sm text-gray-600">
              Drag & drop here (or click). We'll automatically check off your checklist.
            </div>

            {/* IMPORTANT:
               Replace this div with your existing Borrower Upload component
               e.g. <BorrowerUploadBox dealId={dealId} />
            */}
            <div className="mt-3 rounded-lg border bg-white p-6 text-sm text-gray-500">
              Dropzone placeholder — wire your existing upload UI here.
            </div>
          </div>

          {/* Recent receipts */}
          <div className="mt-4">
            <div className="text-sm font-semibold">Recently received</div>
            <div className="mt-2 space-y-2">
              {(data.receipts ?? []).slice(0, 6).map((r) => (
                <div key={r.id} className="rounded-lg border bg-white p-3">
                  <div className="text-sm font-medium">{r.filename}</div>
                  <div className="mt-1 text-xs text-gray-500">{new Date(r.received_at).toLocaleString()}</div>
                </div>
              ))}
              {(!data.receipts || data.receipts.length === 0) ? (
                <div className="text-sm text-gray-600">No uploads yet — start with any document you have.</div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right: Buddy Coach with "I can't find it" flow */}
        <div className="space-y-4">
          {unwrappedParams?.dealId && <BuddyCoachCard dealId={unwrappedParams.dealId} guidedSnapshot={data} />}
          {/* Chat */}
          {unwrappedParams?.dealId && <BorrowerChat dealId={unwrappedParams.dealId} />}
        </div>
      </div>
    </div>
  );
}

function BorrowerChat(props: { dealId: string }) {
  const [messages, setMessages] = React.useState<any[]>([]);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    setError(null);
    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/chat`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load chat");
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
  }, [props.dealId]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText("");

    const token = localStorage.getItem("buddy_invite_token");
    if (!token) {
      setError("No invite token found");
      return;
    }

    const res = await fetch(`/api/portal/deals/${props.dealId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ body }),
    });
    const json = await res.json();
    if (!json?.ok) setError(json?.error ?? "Send failed");
    await load();
  }

  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="text-base font-semibold">Chat with your bank</div>
      <div className="mt-1 text-sm text-gray-600">Ask anything. No "dumb questions."</div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

      <div className="mt-3 max-h-72 space-y-2 overflow-auto rounded-xl border bg-gray-50 p-3">
        {loading ? (
          <div className="text-sm text-gray-600">Loading messages…</div>
        ) : (messages ?? []).length ? (
          messages.map((m) => (
            <div key={m.id} className={`rounded-lg border bg-white p-3 ${m.sender_role === "borrower" ? "" : ""}`}>
              <div className="text-xs text-gray-500">
                {m.sender_display} • {new Date(m.created_at).toLocaleString()}
              </div>
              <div className="mt-1 text-sm text-gray-800">{m.body}</div>
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-600">No messages yet — say hello 👋</div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="h-11 w-full rounded-md border px-3 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type a message…"
        />
        <button className="h-11 rounded-md border px-4 text-sm font-medium hover:bg-gray-50" onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
