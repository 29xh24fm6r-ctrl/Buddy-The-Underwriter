// src/app/deals/new/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const DEAL_TYPES = [
  "Commercial Real Estate",
  "Line of Credit",
  "Term Loan",
  "Equipment",
  "SBA 7(a)",
  "SBA 504",
];

export default function NewDealPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [dealType, setDealType] = useState(DEAL_TYPES[0]);
  const [borrowerEmail, setBorrowerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = useMemo(() => name.trim().length > 0 && dealType.trim().length > 0 && !busy, [name, dealType, busy]);

  async function handleCreate() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          deal_type: dealType,
          borrower_email: borrowerEmail.trim() || null,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setErr(json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ""}` : `http_${res.status}`);
        return;
      }

      const dealId = String(json.deal_id || "");
      if (!dealId) {
        setErr("deal_create_failed: missing deal_id");
        return;
      }

      router.push(`/deals/${encodeURIComponent(dealId)}`);
    } catch (e: any) {
      setErr(`create_failed: ${e?.message || "fetch_failed"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold">Create Deal</h1>
        <p className="text-muted-foreground mt-2">
          Create the workspace, then Buddy will build the pack + checklist.
        </p>

        <div className="mt-6 rounded-2xl border p-5 space-y-4">
          {err ? (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              {err}
            </div>
          ) : null}

          <div>
            <label className="text-sm font-semibold">Deal Name</label>
            <input
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="e.g., Samaritus"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-semibold">Deal Type</label>
            <select
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
              value={dealType}
              onChange={(e) => setDealType(e.target.value)}
            >
              {DEAL_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold">Borrower Email (optional)</label>
            <input
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="borrower@company.com"
              value={borrowerEmail}
              onChange={(e) => setBorrowerEmail(e.target.value)}
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            className="rounded-xl border px-4 py-2 text-sm font-semibold bg-black text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create & Open Workspace"}
          </button>
        </div>
      </div>
    </div>
  );
}
