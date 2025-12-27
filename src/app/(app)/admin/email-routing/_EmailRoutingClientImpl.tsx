"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Routing = {
  contact_to_email: string;
  outbound_from_email: string;
  reply_to_mode: "submitter" | "configured";
  configured_reply_to_email: string | null;
  is_enabled: boolean;
  updated_at?: string;
};

export default function EmailRoutingAdminPage() {
  const sp = useSearchParams();
  const bankId = useMemo(() => sp.get("bankId") ?? "", [sp]);

  const [routing, setRouting] = useState<Routing | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (!bankId) {
      setErr("Missing bankId in query string (?bankId=...)");
      return;
    }
    fetch(`/api/admin/banks/${encodeURIComponent(bankId)}/email-routing`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) =>
        setRouting(
          j.routing ?? {
            contact_to_email: "",
            outbound_from_email: "",
            reply_to_mode: "submitter",
            configured_reply_to_email: null,
            is_enabled: true,
          }
        )
      )
      .catch((e) => setErr(e?.message ?? "Failed to load"));
  }, [bankId]);

  async function save() {
    if (!routing) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch(`/api/admin/banks/${encodeURIComponent(bankId)}/email-routing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(routing),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? "Save failed");
      setOk("Saved successfully");
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Email Routing Configuration</h1>
      <div className="text-sm text-gray-600">
        Bank: <span className="font-mono">{bankId || "(none)"}</span>
      </div>
      <p className="text-sm text-gray-600">
        Configure email routing for contact form submissions. Bank-specific config overrides environment defaults.
      </p>

      {err ? <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{err}</div> : null}
      {ok ? <div className="text-sm text-green-600 bg-green-50 p-3 rounded">{ok}</div> : null}

      {!routing ? <div>Loading…</div> : (
        <>
          <div className="space-y-2">
        <label className="block text-sm font-medium">Contact TO (destination inbox)</label>
        <input
          className="w-full border rounded px-3 py-2"
          value={routing.contact_to_email}
          onChange={(e) => setRouting({ ...routing, contact_to_email: e.target.value })}
          placeholder="sales@buddytheunderwriter.com"
        />
        <div className="text-xs text-gray-500">Email address where contact form submissions will be sent.</div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Outbound FROM (must be verified sender)</label>
        <input
          className="w-full border rounded px-3 py-2"
          value={routing.outbound_from_email}
          onChange={(e) => setRouting({ ...routing, outbound_from_email: e.target.value })}
          placeholder="Underwriting <underwriting@buddytheunderwriter.com>"
        />
        <div className="text-xs text-gray-500">
          For deliverability, this must be a verified sender/domain in Resend. Format: "Name &lt;email@domain.com&gt;"
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Reply-To mode</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={routing.reply_to_mode}
          onChange={(e) => setRouting({ ...routing, reply_to_mode: e.target.value as Routing["reply_to_mode"] })}
        >
          <option value="submitter">Submitter email (recommended)</option>
          <option value="configured">Configured Reply-To</option>
        </select>
        <div className="text-xs text-gray-500">
          Submitter mode uses the contact form submitter's email for Reply-To (best UX).
        </div>
      </div>

      {routing.reply_to_mode === "configured" ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium">Configured Reply-To</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={routing.configured_reply_to_email ?? ""}
            onChange={(e) => setRouting({ ...routing, configured_reply_to_email: e.target.value || null })}
            placeholder="support@buddytheunderwriter.com"
          />
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          id="enabled"
          type="checkbox"
          checked={routing.is_enabled}
          onChange={(e) => setRouting({ ...routing, is_enabled: e.target.checked })}
        />
        <label htmlFor="enabled" className="text-sm">Enabled</label>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center rounded bg-black text-white px-4 py-2 disabled:opacity-50 hover:bg-gray-800 transition"
      >
        {saving ? "Saving…" : "Save Configuration"}
      </button>

      {routing.updated_at ? (
        <div className="text-xs text-gray-500">
          Last updated: {new Date(routing.updated_at).toLocaleString()}
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}
