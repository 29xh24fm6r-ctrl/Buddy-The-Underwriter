"use client";

import React, { useEffect, useMemo, useState } from "react";

type UserRow = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: number;
  lastSignInAt: number | null;
  role: string | null;
};

type LoadResponse =
  | { ok: true; users: UserRow[] }
  | { ok: false; error: string };

const ROLE_ORDER = ["super_admin", "bank_admin", "underwriter", "borrower"] as const;

type BuddyRole = (typeof ROLE_ORDER)[number];

type Capability = {
  key: string;
  label: string;
  risk: "low" | "med" | "high";
  description?: string;
};

const CAPABILITIES: Capability[] = [
  {
    key: "manage_roles",
    label: "Manage Roles",
    risk: "high",
    description: "Can set Clerk role metadata.",
  },
  {
    key: "manage_bank_templates",
    label: "Manage Bank Templates",
    risk: "med",
    description: "Can upload templates and configure mappings.",
  },
  {
    key: "underwrite_deals",
    label: "Underwrite Deals",
    risk: "med",
    description: "Can review borrower documents and underwriting outputs.",
  },
  {
    key: "borrower_portal",
    label: "Borrower Portal",
    risk: "low",
    description: "Can view and upload requested documents.",
  },
];

function roleCapabilities(role: BuddyRole | null): Set<string> {
  // This is a *UI view* of the current role model.
  // It does not change enforcement; enforcement lives in server code.
  switch (role) {
    case "super_admin":
      return new Set(CAPABILITIES.map((c) => c.key));
    case "bank_admin":
      return new Set(["manage_bank_templates", "underwrite_deals"]);
    case "underwriter":
      return new Set(["underwrite_deals"]);
    case "borrower":
      return new Set(["borrower_portal"]);
    default:
      return new Set();
  }
}

function toBuddyRole(role: string | null): BuddyRole | null {
  if (!role) return null;
  return (ROLE_ORDER as readonly string[]).includes(role) ? (role as BuddyRole) : null;
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PermissionsAdminClient() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<BuddyRole | "all" | "none">("all");
  const [highlightHighRisk, setHighlightHighRisk] = useState(true);

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

  useEffect(() => {
    void load();
  }, []);

  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = r.role ?? "(none)";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((u) => {
        if (roleFilter === "all") return true;
        if (roleFilter === "none") return !u.role;
        return u.role === roleFilter;
      })
      .filter((u) => {
        if (!q) return true;
        const hay = [u.email, u.firstName, u.lastName, u.id].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.email ?? a.id).localeCompare(b.email ?? b.id));
  }, [rows, query, roleFilter]);

  const matrix = useMemo(() => {
    const roles: Array<{ role: BuddyRole | null; label: string }> = [
      { role: "super_admin", label: "super_admin" },
      { role: "bank_admin", label: "bank_admin" },
      { role: "underwriter", label: "underwriter" },
      { role: "borrower", label: "borrower" },
      { role: null, label: "(no role)" },
    ];

    return roles.map((r) => ({
      ...r,
      caps: roleCapabilities(r.role),
      count: roleCounts.get(r.role ?? "(none)") ?? 0,
    }));
  }, [roleCounts]);

  function exportCsv() {
    const header = ["role", "user_count", ...CAPABILITIES.map((c) => c.key)].join(",");
    const lines = matrix.map((r) => {
      const cols = [
        JSON.stringify(r.label),
        String(r.count),
        ...CAPABILITIES.map((c) => (r.caps.has(c.key) ? "1" : "0")),
      ];
      return cols.join(",");
    });
    const csv = [header, ...lines].join("\n");
    downloadText(`buddy-permissions-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-semibold">Permissions</div>
          <div className="text-sm text-muted-foreground">
            Buddy currently uses role-based authorization (Clerk <span className="font-mono">publicMetadata.role</span>).
            This screen is a live view of users + role capabilities.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="border rounded px-3 py-1" onClick={load} disabled={busy}>
            {busy ? "Loading…" : "Refresh"}
          </button>
          <button className="border rounded px-3 py-1" onClick={exportCsv} disabled={busy}>
            Export CSV
          </button>
        </div>
      </div>

      {error && <div className="border border-red-500/40 bg-red-500/10 text-red-200 rounded p-3 text-sm">{error}</div>}

      <div className="flex flex-col md:flex-row gap-3 md:items-end">
        <div className="flex-1">
          <label className="block text-xs text-muted-foreground mb-1">Search users</label>
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="email, name, user id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">Role filter</label>
          <select
            className="border rounded px-3 py-2"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
          >
            <option value="all">All</option>
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="none">(no role)</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="border rounded"
            checked={highlightHighRisk}
            onChange={(e) => setHighlightHighRisk(e.target.checked)}
          />
          Highlight high-risk
        </label>
      </div>

      <div className="border rounded overflow-hidden">
        <div className="overflow-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-left">
                <th className="p-3">Role</th>
                <th className="p-3">Users</th>
                {CAPABILITIES.map((c) => (
                  <th key={c.key} className="p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          highlightHighRisk && c.risk === "high"
                            ? "text-red-600 font-semibold"
                            : ""
                        }
                      >
                        {c.label}
                      </span>
                      <span className="text-xs text-muted-foreground">({c.risk})</span>
                    </div>
                    {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.label} className="border-t">
                  <td className="p-3 font-medium">{r.label}</td>
                  <td className="p-3 font-mono">{r.count}</td>
                  {CAPABILITIES.map((c) => (
                    <td key={c.key} className="p-3">
                      {r.caps.has(c.key) ? "✅" : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Users (filtered)</div>
        <div className="text-sm text-muted-foreground">
          To change roles, use the Roles screen. This view is read-only by design.
        </div>

        <div className="border rounded divide-y">
          {filteredUsers.map((u) => {
            const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
            const role = toBuddyRole(u.role);
            const caps = roleCapabilities(role);
            return (
              <div key={u.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{u.email ?? u.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {name || "—"} • role: {u.role ?? "—"}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  caps: {Array.from(caps).length}
                </div>
              </div>
            );
          })}
          {!busy && filteredUsers.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">No users match your filters.</div>
          )}
        </div>
      </div>
    </div>
  );
}
