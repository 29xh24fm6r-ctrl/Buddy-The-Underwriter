"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Bank = { id: string; code: string; name: string };

export default function SelectBankPage() {
  const router = useRouter();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/banks");
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Failed to load banks");
        setBanks(json.banks || []);
      } catch (e: any) {
        setErr(e?.message || "Failed to load banks");
      }
    })();
  }, []);

  async function save() {
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

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-lg rounded-xl border p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Select your bank</h1>
        <p className="mt-2 text-sm text-gray-600">
          This attaches your user to a tenant (bank) and scopes all deals and data.
        </p>

        {err ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
            {err}
          </div>
        ) : null}

        <div className="mt-4">
          <label className="text-sm font-medium">Bank</label>
          <select
            className="mt-1 w-full rounded-md border p-2"
            value={bankId}
            onChange={(e) => setBankId(e.target.value)}
          >
            <option value="">Choose…</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>

        <button
          className="mt-4 w-full rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
          disabled={!bankId || busy}
          onClick={save}
        >
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
    </main>
  );
}
