"use client";

import { useEffect, useMemo, useState } from "react";

type InviteResponse = {
  inviteId: string;
  expiresAt: string;
  portalUrl: string;
};

type SeedResponse = {
  ok: boolean;
  inserted: number;
  totalDesired: number;
};

type Notif = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  status: string;
};

function fmt(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US");
}

export default function BorrowerPortalControlsCard({ dealId }: { dealId: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState<InviteResponse | null>(null);

  const [busyInvite, setBusyInvite] = useState(false);
  const [busyRevoke, setBusyRevoke] = useState(false);
  const [busySeed, setBusySeed] = useState(false);
  const [busySend, setBusySend] = useState(false);
  const [busyAuto, setBusyAuto] = useState(false);

  const [msg, setMsg] = useState("");
  const [authorName, setAuthorName] = useState("Lending Team");

  const [seedResult, setSeedResult] = useState<SeedResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [busyNotifs, setBusyNotifs] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const canCreateInvite = useMemo(() => !busyInvite, [busyInvite]);

  async function refreshNotifs() {
    setBusyNotifs(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/notifications`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setNotifs(json.notifications || []);
    } catch (e: any) {
      setToast(e?.message || "Failed to load notifications");
    } finally {
      setBusyNotifs(false);
    }
  }

  useEffect(() => {
    refreshNotifs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function createInvite() {
    setBusyInvite(true);
    setSeedResult(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim() || null,
          name: name.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setInvite(json);
      setToast("Borrower link generated.");
    } catch (e: any) {
      setToast(e?.message || "Failed to generate link");
    } finally {
      setBusyInvite(false);
    }
  }

  async function revokeInvites() {
    setBusyRevoke(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/revoke`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setInvite(null);
      setToast("All borrower links revoked.");
    } catch (e: any) {
      setToast(e?.message || "Failed to revoke");
    } finally {
      setBusyRevoke(false);
    }
  }

  async function seedRequests() {
    setBusySeed(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/seed-requests`, {
        method: "POST",
      });
      const json = (await res.json()) as SeedResponse;
      if (!res.ok) throw new Error((json as any)?.error || `HTTP ${res.status}`);
      setSeedResult(json);
      setToast(`Seeded requests: +${json.inserted}`);
    } catch (e: any) {
      setToast(e?.message || "Failed to seed requests");
    } finally {
      setBusySeed(false);
    }
  }

  async function sendBankMessage() {
    if (!msg.trim()) return;
    setBusySend(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/messages/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: msg.trim(),
          authorName: authorName.trim() || "Lending Team",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setMsg("");
      setToast("Message sent to borrower thread.");
      refreshNotifs();
    } catch (e: any) {
      setToast(e?.message || "Failed to send message");
    } finally {
      setBusySend(false);
    }
  }

  async function runAutopilot() {
    setBusyAuto(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/autopilot/tick`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setToast(`Autopilot ran: processed ${json.uploadsProcessed} uploads.`);
      refreshNotifs();
    } catch (e: any) {
      setToast(e?.message || "Autopilot failed");
    } finally {
      setBusyAuto(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied to clipboard.");
    } catch {
      setToast("Copy failed (browser permissions).");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">Borrower Portal</div>
          <div className="text-sm text-slate-600">
            Generate a secure borrower link, seed requests, message the borrower, and run Autopilot.
          </div>
        </div>

        {toast && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {toast}
          </div>
        )}
      </div>

      <div className="px-4 pb-4 space-y-4">
        {/* Invite block */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-slate-900">Invite Link</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Borrower name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Borrower email (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canCreateInvite}
              onClick={createInvite}
              className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busyInvite ? "Generating…" : "Generate Borrower Link"}
            </button>

            <button
              type="button"
              disabled={busyRevoke}
              onClick={revokeInvites}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busyRevoke ? "Revoking…" : "Revoke Links"}
            </button>
          </div>

          {invite && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600">Portal link</div>
              <div className="mt-1 break-all text-sm font-semibold text-slate-900">{invite.portalUrl}</div>
              <div className="mt-1 text-xs text-slate-500">Expires: {fmt(invite.expiresAt)}</div>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => copy(invite.portalUrl)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Copy Link
                </button>
                <a
                  href={invite.portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Open Portal
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Seed + Autopilot */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-slate-900">Autopilot</div>
          <div className="text-xs text-slate-600 mt-1">
            Seeds borrower requests from open conditions/mitigants and auto-matches uploads to requests.
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busySeed}
              onClick={seedRequests}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busySeed ? "Seeding…" : "Seed Requests"}
            </button>

            <button
              type="button"
              disabled={busyAuto}
              onClick={runAutopilot}
              className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busyAuto ? "Running…" : "Run Autopilot Now"}
            </button>

            {seedResult && (
              <div className="text-xs text-slate-600">
                Inserted <span className="font-semibold text-slate-900">{seedResult.inserted}</span> of{" "}
                <span className="font-semibold text-slate-900">{seedResult.totalDesired}</span> desired.
              </div>
            )}
          </div>
        </div>

        {/* Bank message */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-slate-900">Send Message</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Author name (e.g., Matt, Underwriting Team)"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
            />
            <div className="hidden md:block" />
          </div>

          <div className="mt-2">
            <textarea
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={3}
              placeholder="Type a message to the borrower…"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
            />
          </div>

          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={busySend || !msg.trim()}
              onClick={sendBankMessage}
              className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busySend ? "Sending…" : "Send"}
            </button>
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">Portal Notifications</div>
              <div className="text-xs text-slate-600 mt-1">Autopilot results + borrower activity.</div>
            </div>
            <button
              type="button"
              onClick={refreshNotifs}
              disabled={busyNotifs}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busyNotifs ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {notifs.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                No notifications yet.
              </div>
            ) : (
              notifs.slice(0, 8).map((n) => (
                <div key={n.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-sm font-semibold text-slate-900">{n.title}</div>
                  <div className="text-xs text-slate-600 mt-1">{n.body}</div>
                  <div className="text-xs text-slate-500 mt-2">{fmt(n.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          Next: we can add a "manual assign" UI (click an upload → pick a request) to resolve unassigned docs in 5 seconds.
        </div>
      </div>
    </div>
  );
}
