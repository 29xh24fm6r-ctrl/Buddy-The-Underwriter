"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Organization = {
  id: string;
  name: string;
  organization_type: string;
  city: string | null;
  state: string | null;
  peopleCount: number;
};

const TYPE_LABELS: Record<string, string> = {
  referral_source: "Referral source",
  professional_partner: "Professional partner",
  other: "Other",
};

export default function BrokerageCrmPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState("referral_source");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/organizations");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setOrgs(json.organizations ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createOrg() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          organizationType: type,
          city: city || null,
          state: state || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "create failed");
      setName("");
      setCity("");
      setState("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="px-8 py-10 max-w-5xl mx-auto text-neutral-100">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">CRM — Organizations</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Referral sources and professional partners — CPAs, attorneys, business
          brokers who send you deals. Every note, call, and task logged against
          them shows up on their timeline.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4 mb-6">
          {error}
        </div>
      )}

      <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4 mb-8">
        <div className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
          Add organization
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input
            className="col-span-2 bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="referral_source">Referral source</option>
            <option value="professional_partner">Professional partner</option>
            <option value="other">Other</option>
          </select>
          <input
            className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <input
            className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
            placeholder="State"
            value={state}
            onChange={(e) => setState(e.target.value)}
          />
        </div>
        <button
          onClick={createOrg}
          disabled={saving || !name.trim()}
          className="mt-3 rounded bg-white text-black text-sm font-medium px-4 py-2 disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add organization"}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : orgs.length === 0 ? (
        <div className="text-sm text-neutral-500">No organizations yet.</div>
      ) : (
        <div className="grid gap-3">
          {orgs.map((o) => (
            <Link
              key={o.id}
              href={`/admin/brokerage/crm/${o.id}`}
              className="rounded-md border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors flex items-center justify-between"
            >
              <div>
                <div className="font-medium">{o.name}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {TYPE_LABELS[o.organization_type] ?? o.organization_type}
                  {(o.city || o.state) && ` · ${[o.city, o.state].filter(Boolean).join(", ")}`}
                </div>
              </div>
              <div className="text-xs text-neutral-500">
                {o.peopleCount} contact{o.peopleCount === 1 ? "" : "s"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
