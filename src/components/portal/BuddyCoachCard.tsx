"use client";

import * as React from "react";

type BuddyResult = {
  reply: string;
  toneTag: "calm" | "cheerful" | "reassuring" | "direct";
  nextBestUpload: { title: string; why: string } | null;
  quickReplies: string[];
};

type MissingDocHelp = {
  reassurance: string;
  substitutes: string[];
  bankerDraft: string;
  cta: string;
};

export function BuddyCoachCard(props: { dealId: string; guidedSnapshot: any }) {
  const [input, setInput] = React.useState("");
  const [thread, setThread] = React.useState<Array<{ role: "borrower" | "buddy"; text: string }>>([
    {
      role: "buddy",
      text: `Hey — I'm Buddy. You're in the right place. 😊\n\nYou don't need to understand lending paperwork. Tell me what you're unsure about, or ask: "What should I upload next?"`,
    },
  ]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [lastQuickReplies, setLastQuickReplies] = React.useState<string[]>([
    "What should I upload next?",
    "I can't find one of the documents",
    "Can I upload phone photos?",
    "What happens next?",
  ]);

  // Missing-doc helper modal state
  const [showMissing, setShowMissing] = React.useState(false);
  const missingItems = (props.guidedSnapshot?.checklist ?? []).filter(
    (i: any) => i.required && i.status === "missing"
  );
  const [missingItemTitle, setMissingItemTitle] = React.useState<string>(missingItems?.[0]?.title ?? "");
  const [missingReason, setMissingReason] = React.useState<string>("");
  const [missingHelp, setMissingHelp] = React.useState<MissingDocHelp | null>(null);
  const [sendingToBank, setSendingToBank] = React.useState(false);

  // Share link state
  const [shareUrl, setShareUrl] = React.useState<string | null>(null);
  const [shareExp, setShareExp] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!missingItemTitle && missingItems?.[0]?.title) setMissingItemTitle(missingItems[0].title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.guidedSnapshot]);

  async function send(msg: string) {
    const message = msg.trim();
    if (!message) return;

    setError(null);
    setLoading(true);
    setThread((t) => [...t, { role: "borrower", text: message }]);
    setInput("");

    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/buddy`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, snapshot: props.guidedSnapshot }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Buddy failed");

      const result: BuddyResult = json.result;
      const extra =
        result.nextBestUpload && result.nextBestUpload.title
          ? `\n\n✅ Suggested next upload: **${result.nextBestUpload.title}**`
          : "";

      setThread((t) => [...t, { role: "buddy", text: `${result.reply}${extra}` }]);
      setLastQuickReplies(result.quickReplies ?? lastQuickReplies);

      // If they said they can't find it, open the helper modal proactively
      if (message.toLowerCase().includes("can't find") || message.toLowerCase().includes("cant find")) {
        setShowMissing(true);
      }
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
      setThread((t) => [
        ...t,
        {
          role: "buddy",
          text:
            "I'm here — something went wrong on my side. No stress.\n\nTry again, or message your bank team in the chat panel.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMissingHelp() {
    setMissingHelp(null);
    setError(null);
    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/buddy/missing-doc`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemTitle: missingItemTitle, stuckReason: missingReason }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Missing-doc helper failed");
      setMissingHelp(json);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    }
  }

  async function sendToBank() {
    if (!missingHelp?.bankerDraft) return;
    setSendingToBank(true);
    setError(null);
    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: missingHelp.bankerDraft }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to send message");

      setThread((t) => [
        ...t,
        { role: "buddy", text: "✅ Done — I sent a note to your bank team so they can tell you the best substitute." },
      ]);
      setShowMissing(false);
      setMissingHelp(null);
      setMissingReason("");
    } catch (e: any) {
   

  async function createShare() {
    setError(null);
    setShareUrl(null);
    try {
      // find checklist item id by title (borrower-safe)
      const item = (props.guidedSnapshot?.checklist ?? []).find((x: any) => x.title === missingItemTitle);
      const itemId = item?.id ? String(item.id) : null;
      if (!itemId) throw new Error("Could not locate checklist item.");

      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/share-links`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          checklistItemIds: [itemId],
          recipientName: "Accountant",
          note: `Please upload: ${missingItemTitle}`,
        }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to create link");

      // Convert relative to absolute for copy/paste
      const absolute = `${window.location.origin}${json.shareUrl}`;
      setShareUrl(absolute);
      setShareExp(json.expiresAt ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
  }   setError(e?.message ?? "Unknown error");
    } finally {
      setSendingToBank(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Buddy (your helper)</div>
          <div className="mt-1 text-sm text-gray-600">Calm guidance • fastest next step • no confusing jargon</div>
        </div>

        <button
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => setShowMissing(true)}
        >
          I can't find it
        </button>
      </div>

      <div className="mt-3 max-h-72 space-y-2 overflow-auto rounded-xl border bg-gray-50 p-3">
        {thread.map((m, idx) => (
          <div key={idx} className={`rounded-lg border bg-white p-3 ${m.role === "borrower" ? "ml-6" : "mr-6"}`}>
            <div className="text-xs text-gray-500">{m.role === "borrower" ? "You" : "Buddy"}</div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{m.text}</div>
          </div>
        ))}
        {loading ? <div className="text-sm text-gray-600">Buddy is thinking…</div> : null}
      </div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {lastQuickReplies.slice(0, 4).map((q) => (
          <button
            key={q}
            className="rounded-full border bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-white"
            onClick={() => send(q)}
            disabled={loading}
          >
            {q}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="h-11 w-full rounded-md border px-3 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Try: "What should I upload next?"'
          onKeyDown={(e) => {
            if (e.key === "Enter") send(input);
          }}
          disabled={loading}
        />
        <button
          className="h-11 rounded-md border px-4 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          onClick={() => send(input)}
          disabled={loading}
        >
          Send
        </button>
      </div>

      {/* Missing-doc helper modal */}
      {showMissing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl rounded-2xl border bg-white p-5 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">No worries — we'll solve it together</div>
                <div className="mt-1 text-sm text-gray-600">
                  Pick what you're stuck on. I'll suggest easy substitutes and send a note to your bank if you want.
               /* Share link creator */}
              <div className="rounded-xl border bg-white p-4">
                <div className="text-sm font-semibold">Request from someone else</div>
                <div className="mt-1 text-sm text-gray-600">
                  If your accountant/bookkeeper has it, generate a secure upload link for just this item.
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="h-11 rounded-md border px-4 text-sm font-medium hover:bg-gray-50" onClick={createShare}>
                    Create secure upload link
                  </button>
                </div>

                {shareUrl ? (
                  <div className="mt-3 rounded-lg border bg-gray-50 p-3">
                    <div className="text-xs text-gray-500">Secure link (share this)</div>
                    <div className="mt-1 break-all text-sm font-medium">{shareUrl}</div>
                    {shareExp ? <div className="mt-1 text-xs text-gray-500">Expires: {new Date(shareExp).toLocaleString()}</div> : null}

                    <div className="mt-2 flex gap-2">
                      <button className="rounded-md border px-3 py-2 text-sm hover:bg-white" onClick={() => copy(shareUrl)}>
                        Copy link
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              { </div>
              </div>
              <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => setShowMissing(false)}>
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <div>
                <div className="text-xs font-semibold text-gray-600">Which item are you missing?</div>
                <select
                  className="mt-1 h-11 w-full rounded-md border px-3 text-sm"
                  value={missingItemTitle}
                  onChange={(e) => setMissingItemTitle(e.target.value)}
                >
                  {missingItems.length ? (
                    missingItems.map((i: any) => (
                      <option key={i.id} value={i.title}>
                        {i.title}
                      </option>
                    ))
                  ) : (
                    <option value="A document">A document</option>
                  )}
                </select>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-600">What's the situation? (optional)</div>
                <input
                  className="mt-1 h-11 w-full rounded-md border px-3 text-sm"
                  value={missingReason}
                  onChange={(e) => setMissingReason(e.target.value)}
                  placeholder="Example: accountant is preparing it / I can't locate it / I'm traveling"
                />
              </div>

              <button className="h-11 rounded-md border px-4 text-sm font-medium hover:bg-gray-50" onClick={loadMissingHelp}>
                Help me find an alternative
              </button>

              {missingHelp ? (
                <div className="rounded-xl border bg-gray-50 p-4">
                  <div className="text-sm font-semibold">Buddy says</div>
                  <div className="mt-1 text-sm text-gray-700">{missingHelp.reassurance}</div>

                  <div className="mt-3 text-sm font-semibold">Easy substitutes</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
                    {missingHelp.substitutes.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>

                  <div className="mt-3 text-sm font-semibold">Message I can send to your bank</div>
                  <div className="mt-1 rounded-lg border bg-white p-3 text-sm text-gray-800">
                    {missingHelp.bankerDraft}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      className="h-11 rounded-md border px-4 text-sm font-medium hover:bg-white disabled:opacity-50"
                      onClick={sendToBank}
                      disabled={sendingToBank}
                    >
                      {sendingToBank ? "Sending…" : missingHelp.cta}
                    </button>
                    <button
                      className="h-11 rounded-md border px-4 text-sm hover:bg-white"
                      onClick={() => {
                        setThread((t) => [
                          ...t,
                          { role: "buddy", text: "If you upload anything close (even a photo/screenshot), we can keep moving while we wait." },
                        ]);
                        setShowMissing(false);
                      }}
                    >
                      I'll upload what I have
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
