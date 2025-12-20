"use client";

import { useState, useEffect } from "react";

type ChecklistItem = {
  id: string;
  checklist_key: string;
  title: string;
  required: boolean;
  received_at: string | null;
};

export default function BorrowerRequestComposerCard({ dealId }: { dealId: string }) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const [channelEmail, setChannelEmail] = useState(true);
  const [channelSms, setChannelSms] = useState(false);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [borrowerName, setBorrowerName] = useState("");

  const [expiresInHours, setExpiresInHours] = useState(72);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");

  const [enableReminders, setEnableReminders] = useState(false);
  const [cadenceDays, setCadenceDays] = useState(3);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/checklist/list`);
      const json = await res.json();
      if (json?.ok && json.items) setItems(json.items);

      const intakeRes = await fetch(`/api/deals/${dealId}/intake/get`);
      const intakeJson = await intakeRes.json();
      if (intakeJson?.ok && intakeJson.intake) {
        const i = intakeJson.intake;
        if (i.borrower_email) setEmail(i.borrower_email);
        if (i.borrower_phone) setPhone(i.borrower_phone);
        if (i.borrower_name) setBorrowerName(i.borrower_name);
      }

      setLoading(false);
    }
    load();
  }, [dealId]);

  const missingItems = items.filter((it) => !it.received_at);

  function toggleKey(k: string) {
    setSelectedKeys((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
    );
  }

  async function send() {
    if (selectedKeys.length === 0) return alert("No keys selected");

    const channels: ("email" | "sms")[] = [];
    if (channelEmail) channels.push("email");
    if (channelSms) channels.push("sms");
    if (channels.length === 0) return alert("No channels selected");

    if (channels.includes("email") && !email.trim()) return alert("Email required");
    if (channels.includes("sms") && !phone.trim()) return alert("Phone required");

    setSending(true);

    const body = {
      channels,
      email: email.trim() || null,
      phone: phone.trim() || null,
      borrowerName: borrowerName.trim() || null,
      checklistKeys: selectedKeys,
      expiresInHours,
      singleUse: true,
      password: password.trim() || null,
      enableReminders,
      cadenceDays,
      label: "Borrower document request",
      note: note.trim() || null,
    };

    const res = await fetch(`/api/deals/${dealId}/borrower-request/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    setSending(false);

    if (!json?.ok) {
      alert("Failed: " + (json.error || "Unknown error"));
      return;
    }

    alert(
      `Sent via ${channels.join(" + ")}!\nUpload link: ${json.uploadUrl}\n\nResults:\n` +
        json.results
          .map((r: any) => `${r.channel} → ${r.destination}: ${r.ok ? "✓" : "✗ " + r.error}`)
          .join("\n")
    );

    // Reset selection
    setSelectedKeys([]);
    window.location.reload();
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
        <div className="text-base font-semibold text-neutral-50">Borrower Request Composer</div>
        <div className="mt-2 text-sm text-neutral-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
      <div className="text-base font-semibold text-neutral-50">Borrower Request Composer</div>
      <div className="mt-1 text-sm text-neutral-400">
        Select missing checklist items → create upload link → send via email/SMS
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <div className="text-xs text-neutral-400">Missing Checklist Items ({missingItems.length})</div>
          <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/30 p-2 space-y-2">
            {missingItems.length === 0 ? (
              <p className="text-sm text-neutral-400">All items received ✓</p>
            ) : (
              missingItems.map((item) => (
                <div key={item.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedKeys.includes(item.checklist_key)}
                    onChange={() => toggleKey(item.checklist_key)}
                    className="mt-1 h-4 w-4"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-neutral-100">{item.title}</div>
                    <div className="text-xs text-neutral-500">{item.checklist_key}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="text-xs text-neutral-400">Channels</div>
          <div className="mt-1 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={channelEmail}
                onChange={(e) => setChannelEmail(e.target.checked)}
                className="h-4 w-4"
              />
              Email
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={channelSms}
                onChange={(e) => setChannelSms(e.target.checked)}
                className="h-4 w-4"
              />
              SMS
            </label>
          </div>
        </div>

        <div>
          <label className="text-xs text-neutral-400">Borrower Name</label>
          <input
            value={borrowerName}
            onChange={(e) => setBorrowerName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Optional"
          />
        </div>

        <div>
          <label className="text-xs text-neutral-400">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Required if email channel enabled"
          />
        </div>

        <div>
          <label className="text-xs text-neutral-400">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Required if SMS channel enabled"
          />
        </div>

        <div>
          <label className="text-xs text-neutral-400">Optional Note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Custom message (optional)"
            rows={2}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-neutral-400">Expires (hours)</label>
            <input
              type="number"
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400">Password (optional)</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
              placeholder="Optional"
            />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input
              type="checkbox"
              checked={enableReminders}
              onChange={(e) => setEnableReminders(e.target.checked)}
              className="h-4 w-4"
            />
            Enable reminders (keys-only, missing items)
          </label>
          {enableReminders && (
            <div className="mt-2 ml-6">
              <label className="text-xs text-neutral-400">Cadence (days)</label>
              <input
                type="number"
                value={cadenceDays}
                onChange={(e) => setCadenceDays(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
              />
            </div>
          )}
        </div>

        <button
          onClick={send}
          disabled={sending || selectedKeys.length === 0}
          className="w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50"
        >
          {sending ? "Sending..." : `Send Request (${selectedKeys.length} keys)`}
        </button>
      </div>
    </div>
  );
}
