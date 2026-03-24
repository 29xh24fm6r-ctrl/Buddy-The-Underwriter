"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Bank = { id: string; code: string; name: string };

/**
 * Map internal error codes to user-facing messages.
 * This page must never surface raw internal reason codes.
 *
 * When the API returns a `detail` string alongside the error code,
 * we prefer the detail (it already contains contextual info like the
 * conflicting bank name). Otherwise fall back to a static message.
 */
function friendlyError(raw: string, detail?: string | null): string {
  const lower = raw.toLowerCase();

  // ── Bank creation structured errors ───────────────────────────────
  if (lower === "bank_name_conflict")
    return detail || "A bank with that name already exists. Please choose a different name.";
  if (lower === "bank_code_conflict")
    return "A temporary code conflict occurred. Please try again.";
  if (lower === "bank_insert_failed")
    return "Could not create the bank. Please try again or contact support.";
  if (lower === "profile_setup_failed")
    return "Your bank was created, but we couldn\u2019t finish setting up your profile. Please try again.";
  if (lower === "membership_failed")
    return "Your bank was created, but we couldn\u2019t link your account. Please try again.";

  // ── Legacy / selection errors ─────────────────────────────────────
  if (lower.includes("profile_required") || lower.includes("profile_update_failed"))
    return "We created your bank, but couldn\u2019t finish setting up your user profile. Please try again.";
  if (lower.includes("bank_creation_failed"))
    return "Could not create bank. Please try a different name or contact support.";
  if (lower.includes("forbidden"))
    return "You don\u2019t have access to that bank. Please select one you belong to.";
  if (lower.includes("bank_not_found"))
    return "That bank could not be found. Please select another.";
  if (lower.includes("unauthorized") || lower.includes("not_authenticated"))
    return "Your session has expired. Please sign in again.";
  if (lower === "name_required")
    return "Please enter a bank name.";

  // Catch-all: don't leak internal codes
  return "Something went wrong. Please try again or contact support.";
}

export default function SelectBankPage() {
  const router = useRouter();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Create bank state
  const [showCreate, setShowCreate] = useState(false);
  const [newBankName, setNewBankName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/banks");
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Failed to load banks");
        setBanks(json.banks || []);
      } catch (e: any) {
        setErr(friendlyError(e?.message || "load_failed"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function selectBank() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/profile/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_id: bankId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(friendlyError(json.error || "select_failed", json.detail));
        return;
      }
      router.replace("/deals");
    } catch (e: any) {
      setErr(friendlyError(e?.message || "select_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function createBank() {
    const name = newBankName.trim();
    if (!name) return;
    setErr(null);
    setCreating(true);
    try {
      const res = await fetch("/api/banks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(friendlyError(json.error || "create_failed", json.detail));
        return;
      }
      // POST /api/banks already sets bank context + profile — just redirect
      router.replace("/deals");
    } catch (e: any) {
      setErr(friendlyError(e?.message || "create_failed"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Buddy <span className="text-white/60">The Underwriter</span>
          </h1>
          <p className="mt-2 text-sm text-white/50">
            {banks.length > 0
              ? "Select a bank or create a new one to continue."
              : "We need to finish setting up your workspace before you continue."}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6 space-y-4">
          {err && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {err}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-white/50 text-center py-4">Loading banks...</p>
          ) : banks.length === 0 && !showCreate ? (
            <div className="text-center py-4 space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/5 border border-white/10">
                <span className="material-symbols-outlined text-white/40 text-xl">account_balance</span>
              </div>
              <p className="text-sm text-white/60">No banks found. Create your first bank to get started.</p>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
              >
                Create Bank
              </button>
            </div>
          ) : !showCreate ? (
            <>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-white/50">Bank</label>
                <select
                  className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/[0.04] p-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                  value={bankId}
                  onChange={(e) => setBankId(e.target.value)}
                >
                  <option value="" className="bg-[#1a1a2e]">Choose...</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id} className="bg-[#1a1a2e]">
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                disabled={!bankId || busy}
                onClick={selectBank}
              >
                {busy ? "Saving..." : "Continue"}
              </button>

              <div className="flex items-center gap-3 text-xs text-white/40">
                <div className="flex-1 border-t border-white/10" />
                or
                <div className="flex-1 border-t border-white/10" />
              </div>

              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10 transition-colors"
              >
                Create New Bank
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-white/50">Bank Name</label>
                <input
                  type="text"
                  className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/[0.04] p-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                  placeholder="e.g. First National Bank"
                  value={newBankName}
                  onChange={(e) => setNewBankName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createBank()}
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setNewBankName(""); }}
                  className="flex-1 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createBank}
                  disabled={!newBankName.trim() || creating}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {creating ? "Creating..." : "Create & Continue"}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="text-center">
          <Link href="/profile" className="text-xs text-white/40 hover:text-white/60 transition-colors">
            Profile Settings
          </Link>
        </div>
      </div>
    </main>
  );
}
