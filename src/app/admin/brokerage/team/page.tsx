"use client";

import { useEffect, useState } from "react";

type Member = {
  membershipId: string;
  clerkUserId: string;
  role: string;
  addedAt: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

type Candidate = {
  clerkUserId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

function displayName(p: { email: string | null; firstName: string | null; lastName: string | null }) {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return name || p.email || "(unnamed)";
}

export default function BrokerageTeamPage() {
  const [team, setTeam] = useState<Member[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [role, setRole] = useState("bank_admin");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brokerage/team");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setTeam(json.team ?? []);
      setCandidates(json.candidates ?? []);
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

  async function addTeammate() {
    if (!selectedUserId) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/brokerage/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerkUserId: selectedUserId, role }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "add failed");
      setSelectedUserId("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "add failed");
    } finally {
      setAdding(false);
    }
  }

  return (
    <main className="px-8 py-10 max-w-3xl mx-auto text-neutral-100">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Team — Buddy Brokerage</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Who has access to Deals, Lenders, CRM, and Billing for this
          tenant. A partner needs a Clerk account first (sign up at{" "}
          <code>app.buddytheunderwriter.com</code>) — they'll show up in
          the list below once they've signed in at least once.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4 mb-6">
          {error}
        </div>
      )}

      <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4 mb-8">
        <div className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
          Add teammate
        </div>
        {candidates.length === 0 && !loading ? (
          <div className="text-sm text-neutral-500">
            No signed-up accounts available to add — have your partner sign
            up first, then refresh this page.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select
                className="md:col-span-2 bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                <option value="">Select a signed-up user…</option>
                {candidates.map((c) => (
                  <option key={c.clerkUserId} value={c.clerkUserId}>
                    {displayName(c)}
                    {c.email ? ` (${c.email})` : ""}
                  </option>
                ))}
              </select>
              <select
                className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="bank_admin">Bank admin — full access</option>
                <option value="underwriter">Underwriter — works deals, no admin config</option>
              </select>
            </div>
            <button
              onClick={addTeammate}
              disabled={adding || !selectedUserId}
              className="mt-3 rounded bg-white text-black text-sm font-medium px-4 py-2 disabled:opacity-40"
            >
              {adding ? "Adding…" : "Add to Buddy Brokerage"}
            </button>
          </>
        )}
      </div>

      <div className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
        Current team ({team.length})
      </div>
      {loading ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : (
        <div className="grid gap-2">
          {team.map((m) => (
            <div
              key={m.membershipId}
              className="rounded border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm flex items-center justify-between"
            >
              <div>
                <span className="font-medium">{displayName(m)}</span>
                {m.email && <span className="text-neutral-500"> · {m.email}</span>}
              </div>
              <span className="text-xs uppercase tracking-wide text-neutral-400">
                {m.role === "bank_admin" ? "Bank admin" : m.role === "underwriter" ? "Underwriter" : m.role}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
