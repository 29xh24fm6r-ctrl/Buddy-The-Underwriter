"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Bank = { id: string; code: string; name: string };

export default function AdminBankPicker() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const initialBankId = useMemo(() => sp.get("bankId") ?? "", [sp]);

  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState(initialBankId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBankId(initialBankId);
  }, [initialBankId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/banks", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error || "Failed to load banks");
        setBanks((json.banks || []).filter(Boolean));
      } catch (e: any) {
        setErr(e?.message || "Failed to load banks");
      }
    })();
  }, []);

  async function onPick(nextBankId: string) {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/profile/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_id: nextBankId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to set bank");

      const next = new URLSearchParams(sp.toString());
      next.set("bankId", nextBankId);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || "Failed to set bank");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground">Bank</label>
      <select
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={bankId}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value;
          setBankId(v);
          if (v) onPick(v);
        }}
      >
        <option value="">Select…</option>
        {banks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.code})
          </option>
        ))}
      </select>
      {err ? <div className="text-xs text-red-600">{err}</div> : null}
    </div>
  );
}
