export const dynamic = "force-dynamic";

"use client";

import React, { useEffect, useState } from "react";

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

export default function RolesAdminPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/users/list", { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error ?? "Failed to load users");
      setRows(j.users ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function setRole(userId: string, role: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/roles/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, role }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error ?? "Failed to set role");
      await load();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">Roles</div>
          <div className="text-sm text-muted-foreground">
            Set Buddy roles via Clerk publicMetadata.role. Super-admin allowlist still overrides.
          </div>
        </div>
        <button className="border rounded px-3 py-1" onClick={load} disabled={busy}>
          {busy ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((u) => (
          <div key={u.id} className="border rounded p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate">{u.email ?? u.id}</div>
              <div className="text-xs text-muted-foreground">
                {u.firstName ?? ""} {u.lastName ?? ""} • role: {u.role ?? "—"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                className="border rounded px-2 py-1"
                defaultValue={u.role ?? ""}
                onChange={(e) => setRole(u.id, e.target.value)}
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
        ))}
        {rows.length === 0 && <div className="text-sm text-muted-foreground">No users found.</div>}
      </div>
    </div>
  );
}
