"use client";

import * as React from "react";

type Receipt = {
  id: string;
  filename: string;
  received_at: string;
  uploader_role: string;
};

export function PortalReceiptsCard({ dealId, bankerUserId }: { dealId: string; bankerUserId: string }) {
  const [receipts, setReceipts] = React.useState<Receipt[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/banker/deals/${dealId}/portal-checklist`, {
        method: "GET",
        headers: { "x-user-id": bankerUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load");
      setReceipts(json.receipts ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, bankerUserId]);

  return (
    <div className="rounded-xl border bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Document receipts</div>
          <div className="mt-1 text-sm text-gray-600">All uploads recorded (borrower + banker)</div>
        </div>
        <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : receipts.length ? (
          <div className="space-y-2">
            {receipts.slice(0, 15).map((r) => (
              <div key={r.id} className="rounded-lg border bg-white p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.filename}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {new Date(r.received_at).toLocaleString()} •{" "}
                      <span className={r.uploader_role === "borrower" ? "text-blue-600" : "text-gray-600"}>
                        {r.uploader_role === "borrower" ? "Borrower upload" : "Banker upload"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {receipts.length > 15 ? (
              <div className="text-sm text-gray-600">+ {receipts.length - 15} more receipts</div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm text-gray-600">No uploads yet</div>
        )}
      </div>
    </div>
  );
}
