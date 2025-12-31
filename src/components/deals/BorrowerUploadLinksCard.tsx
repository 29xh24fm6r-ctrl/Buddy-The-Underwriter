"use client";

import React, { useEffect, useState } from "react";

type LinkRow = {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  single_use: boolean;
  used_at: string | null;
  require_password: boolean;
  label: string | null;
};

function fmt(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

function statusOf(l: LinkRow): { label: string; tone: "good" | "warn" | "bad" | "neutral" } {
  const now = Date.now();
  const exp = new Date(l.expires_at).getTime();

  if (l.revoked_at) return { label: "Revoked", tone: "bad" };
  if (exp < now) return { label: "Expired", tone: "warn" };
  if (l.single_use && l.used_at) return { label: "Used", tone: "neutral" };
  return { label: "Active", tone: "good" };
}

export default function BorrowerUploadLinksCard({ dealId }: { dealId: string }) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Avoid hydration mismatch: server render has no window, so keep this empty
  // on first client render and fill it after mount.
  const [origin, setOrigin] = useState("");

  const [expiresHours, setExpiresHours] = useState(72);
  const [singleUse, setSingleUse] = useState(true);
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("Borrower docs");

  async function refresh() {
    setMsg(null);
    const res = await fetch(`/api/deals/${dealId}/upload-links/list`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "Failed to load links.");
      return;
    }
    setLinks(json.links || []);
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function createLink() {
    setBusy(true);
    setMsg("Creating link…");
    try {
      const res = await fetch(`/api/deals/${dealId}/upload-links/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expiresInHours: expiresHours,
          singleUse,
          password: password.trim() ? password.trim() : null,
          label: label.trim() ? label.trim() : null,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Failed to create link.");
        return;
      }

      const url = String(json.url || "");
      await navigator.clipboard.writeText(url);
      setMsg("Link created and copied to clipboard.");
      setPassword("");
      await refresh();
    } catch (e: any) {
      setMsg(e?.message || "Failed to create link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setMsg("Revoking…");
    try {
      const res = await fetch(`/api/deals/${dealId}/upload-links/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Failed to revoke.");
        return;
      }
      setMsg("Revoked.");
      await refresh();
    } catch (e: any) {
      setMsg(e?.message || "Failed to revoke.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-neutral-50">Borrower Upload Links</div>
          <div className="mt-1 text-sm text-neutral-400">
            Create secure, expiring, deal-scoped upload links. Link is copied automatically.
          </div>
        </div>
        <button
          onClick={refresh}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
          disabled={busy}
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="text-xs text-neutral-400">Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Borrower docs"
          />
        </div>
        <div>
          <label className="text-xs text-neutral-400">Expires (hours)</label>
          <input
            value={expiresHours}
            onChange={(e) => setExpiresHours(Number(e.target.value || 72))}
            type="number"
            min={1}
            max={720}
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
          />
        </div>
        <div className="flex items-end gap-2">
          <button
            onClick={createLink}
            disabled={busy}
            className="w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50"
          >
            {busy ? "Working…" : "Create + Copy"}
          </button>
        </div>

        <div className="md:col-span-2">
          <label className="text-xs text-neutral-400">Optional password</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="text"
            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="(leave blank for none)"
          />
        </div>
        <div className="md:col-span-2 flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input
              type="checkbox"
              checked={singleUse}
              onChange={(e) => setSingleUse(e.target.checked)}
              className="h-4 w-4"
            />
            Single-use
          </label>
          <div className="text-xs text-neutral-500">
            Borrower link page: <span className="text-neutral-300">{origin}/upload/&lt;token&gt;</span>
          </div>
        </div>
      </div>

      {msg ? (
        <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm text-neutral-200">
          {msg}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-xs font-semibold text-neutral-400">Recent links</div>

        <div className="mt-2 space-y-2">
          {links.length === 0 ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 text-sm text-neutral-400">
              No links yet.
            </div>
          ) : null}

          {links.map((l) => {
            const s = statusOf(l);
            const tone =
              s.tone === "good"
                ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-200"
                : s.tone === "warn"
                ? "border-amber-900/40 bg-amber-950/20 text-amber-200"
                : s.tone === "bad"
                ? "border-red-900/40 bg-red-950/20 text-red-200"
                : "border-neutral-800 bg-neutral-950/20 text-neutral-200";

            return (
              <div
                key={l.id}
                className={`rounded-xl border p-3 ${tone} flex flex-col gap-2 md:flex-row md:items-center md:justify-between`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{s.label}</span>
                    {l.label ? (
                      <span className="truncate text-sm text-neutral-100">{l.label}</span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs opacity-80">
                    Expires: {fmt(l.expires_at)}{" "}
                    {l.single_use ? "• Single-use" : "• Multi-use"}{" "}
                    {l.require_password ? "• Password" : ""}
                    {l.used_at ? ` • Used: ${fmt(l.used_at)}` : ""}
                    {l.revoked_at ? ` • Revoked: ${fmt(l.revoked_at)}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    disabled={busy || !!l.revoked_at}
                    onClick={() => revoke(l.id)}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
