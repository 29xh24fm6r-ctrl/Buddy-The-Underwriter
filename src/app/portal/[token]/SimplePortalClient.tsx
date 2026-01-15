"use client";

import React, { useEffect, useState } from "react";
import { uploadBorrowerFile } from "@/lib/uploads/uploadFile";

export default function BorrowerPortalClient({ token }: { token: string }) {
  const [dealId, setDealId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<any>(null);

  useEffect(() => {
    (async () => {
      setErr(null);
      const r = await fetch("/api/borrower/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      if (!j?.ok) {
        setErr(j?.error ?? "Unable to open portal link");
        return;
      }
      setDealId(j.dealId);

      // Load missing docs plan
      const r2 = await fetch(`/api/deals/${j.dealId}/missing-docs`);
      const j2 = await r2.json();
      if (j2?.ok) setPlan(j2.plan);
    })();
  }, [token]);

  if (err) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold">Borrower Portal</div>
          <div className="mt-2 text-sm text-red-700">{err}</div>
        </div>
      </div>
    );
  }

  if (!dealId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">Loading portal…</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-sm text-slate-500">Borrower Portal</div>
        <div className="text-2xl font-semibold">Upload documents</div>
        <div className="text-sm text-slate-600">
          Upload files below. Your missing-docs list updates automatically as documents are processed.
        </div>
      </div>

      {plan && plan.open_count > 0 && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold mb-4">Documents needed</div>
          <div className="space-y-3">
            {plan.items.map((it: any, i: number) => (
              <div key={i} className="border-l-4 border-blue-500 bg-blue-50 p-3 rounded-r">
                <div className="font-medium">{it.title}</div>
                {it.detail && <div className="text-sm text-slate-600 mt-1">{it.detail}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {plan && plan.open_count === 0 && (
        <div className="rounded-2xl border bg-green-50 border-green-200 p-6 shadow-sm">
          <div className="text-lg font-semibold text-green-800">✅ All documents received</div>
          <div className="text-sm text-green-700 mt-1">
            Thank you! We have everything we need to continue processing your request.
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="text-lg font-semibold mb-4">Upload files</div>
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
          <input
            type="file"
            multiple
            className="hidden"
            id="file-upload"
            onChange={async (e) => {
              if (!e.target.files || !dealId) return;
              
              const uploadedFiles = Array.from(e.target.files);
              for (const file of uploadedFiles) {
                const result = await uploadBorrowerFile(token, file, null);
                
                if (!result.ok) {
                  console.error(`Failed to upload ${file.name}:`, result.error);
                }
              }
              
              // Reload plan
              const r = await fetch(`/api/deals/${dealId}/missing-docs`);
              const j = await r.json();
              if (j?.ok) setPlan(j.plan);
            }}
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Choose files to upload
          </label>
          <div className="mt-2 text-sm text-slate-500">
            or drag and drop files here
          </div>
        </div>
      </div>
    </div>
  );
}
