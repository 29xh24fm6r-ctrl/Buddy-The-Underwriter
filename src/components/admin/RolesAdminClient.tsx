"use client";

import React, { useEffect, useMemo, useState } from "react";

type Row = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: number;
  lastSignInAt: number | null;
  role: string | null;
};

const ROLES = ["super_admin", "bank_admin", "underwriter", "borrower"] as const;

type BuddyRole = (typeof ROLES)[number];

type LoadResponse =
  | { ok: true; users: Row[] }
  | { ok: false; error: string };

type SetRoleResponse =
  | { ok: true; user_id: string; role: BuddyRole | null }
  | { ok: false; error: string };

export default function RolesAdminClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ae = a.email ?? "";
      const be = b.email ?? "";
      return ae.localeCompare(be);
    });
  }, [rows]);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/users/list", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as LoadResponse | null;
      if (!j?.ok) throw new Error(j?.error ?? `Failed to load users (${r.status})`);
      setRows(j.users ?? []);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function setRole(userId: string, role: BuddyRole | null) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/roles/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, role }),
      });
      const j = (await r.json().catch(() => null)) as SetRoleResponse | null;
      if (!j?.ok) throw new Error(j?.error ?? `Failed to set role (${r.status})`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-semibold">Roles</div>
          <div className="text-sm text-muted-foreground">
            Sets Clerk <span className="font-mono">publicMetadata.role</span>. Super-admin allowlist still overrides.
          </div>
        </div>
        <button className="border rounded px-3 py-1" onClick={load} disabled={busy}>
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="border border-red-500/40 bg-red-500/10 text-red-200 rounded p-3 text-sm">{error}</div>}

      <div className="space-y-2">
        {sortedRows.map((u) => {
          const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
          const roleValue = (u.role ?? "") as BuddyRole | "";
          return (
            <div key={u.id} className="border rounded p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{u.email ?? u.id}</div>
                <div className="text-xs text-muted-foreground">
                  {name || "—"} • role: {u.role ?? "—"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  className="border rounded px-2 py-1"
                  value={roleValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    void setRole(u.id, (v ? (v as BuddyRole) : null));
                  }}
                  disabled={busy}
                >
                  <option value="">(no role)</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>

                <button
                  className="border rounded px-3 py-1"
                  onClick={() => setRole(u.id, "underwriter")}
                  disabled={busy}
                >
                  Make Underwriter
                </button>
              </div>
            </div>
          );
        })}

        {!busy && sortedRows.length === 0 && (
          <div className="text-sm text-muted-foreground">No users found.</div>
        )}
      </div>
    </div>
  );
}
