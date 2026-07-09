"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";

type Activity = {
  id: string;
  kind: string;
  happens_at: string;
  title: string | null;
  properties: Record<string, unknown>;
};

const KIND_LABELS: Record<string, string> = {
  note: "Note",
  task: "Task",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  stage_change: "Stage change",
  system: "System",
};

export default function CrmOrganizationDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = usePromise(params);

  const [org, setOrg] = useState<any>(null);
  const [people, setPeople] = useState<any[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/organizations/${orgId}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setOrg(json.organization);
      setPeople(json.people ?? []);
      setActivities(json.activities ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function logNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "note",
          organizationId: orgId,
          title: noteText.slice(0, 80),
          properties: { body: noteText },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save failed");
      setNoteText("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="px-8 py-10 max-w-4xl mx-auto text-neutral-100">Loading…</main>;
  }
  if (error || !org) {
    return (
      <main className="px-8 py-10 max-w-4xl mx-auto text-neutral-100">
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4">
          {error ?? "Organization not found"}
        </div>
      </main>
    );
  }

  return (
    <main className="px-8 py-10 max-w-4xl mx-auto text-neutral-100">
      <Link href="/admin/brokerage/crm" className="text-sm text-neutral-400 hover:underline">
        ← Organizations
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold">{org.name}</h1>
        <p className="text-sm text-neutral-400 mt-1">
          {org.organization_type}
          {(org.city || org.state) && ` · ${[org.city, org.state].filter(Boolean).join(", ")}`}
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
          Contacts ({people.length})
        </h2>
        {people.length === 0 ? (
          <div className="text-sm text-neutral-500">No contacts yet.</div>
        ) : (
          <div className="grid gap-2">
            {people.map((p) => (
              <div
                key={p.id}
                className="rounded border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm"
              >
                <span className="font-medium">
                  {[p.first_name, p.last_name].filter(Boolean).join(" ") || "(unnamed)"}
                </span>
                {p.job_title && <span className="text-neutral-500"> · {p.job_title}</span>}
                {p.email && <span className="text-neutral-500"> · {p.email}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wide text-neutral-400 mb-3">Timeline</h2>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4 mb-4">
          <textarea
            className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
            rows={2}
            placeholder="Log a note…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <button
            onClick={logNote}
            disabled={saving || !noteText.trim()}
            className="mt-2 rounded bg-white text-black text-sm font-medium px-4 py-1.5 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Add note"}
          </button>
        </div>

        {activities.length === 0 ? (
          <div className="text-sm text-neutral-500">No activity yet.</div>
        ) : (
          <div className="grid gap-2">
            {activities.map((a) => (
              <div
                key={a.id}
                className="rounded border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs uppercase tracking-wide text-neutral-500">
                    {KIND_LABELS[a.kind] ?? a.kind}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {new Date(a.happens_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                {a.title && <div className="mt-1">{a.title}</div>}
                {typeof a.properties?.body === "string" && a.properties.body !== a.title && (
                  <div className="mt-1 text-neutral-400">{a.properties.body as string}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
