"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Bank = { id: string; code: string; name: string };

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
        setErr(e?.message || "Failed to load banks");
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
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to save bank");
      router.replace("/deals");
    } catch (e: any) {
      setErr(e?.message || "Failed to save bank");
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
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to create bank");
      // Auto-select the newly created bank
      const created = json.bank as Bank;
      setBanks((prev) => [...prev, created]);
      setBankId(created.id);
      setNewBankName("");
      setShowCreate(false);
      // Auto-save selection
      const selRes = await fetch("/api/profile/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_id: created.id }),
      });
      const selJson = await selRes.json().catch(() => ({}));
      if (!selRes.ok || !selJson.ok) throw new Error(selJson.error || "Failed to select bank");
      router.replace("/deals");
    } catch (e: any) {
      setErr(e?.message || "Failed to create bank");
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
          <p className="mt-2 text-sm text-white/50">Select or create a bank to continue</p>
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
