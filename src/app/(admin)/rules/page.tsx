"use client";

import React, { useEffect, useState } from "react";

type Latest = any;

export default function RulesAdminPage() {
  const [ruleSetKey, setRuleSetKey] = useState("SBA_CTC_DEFAULTS");
  const [latest, setLatest] = useState<Latest | null>(null);
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState(
    JSON.stringify(
      {
        rule_set_key: "SBA_CTC_DEFAULTS",
        version: new Date().toISOString().slice(0, 10),
        rules: {
          ctc_defaults: [
            { code: "EXAMPLE_DOC", required: true, doc_type: "PFS" }
          ],
        },
      },
      null,
      2
    )
  );

  async function refresh() {
    const r = await fetch(`/api/rules/sba/active?rule_set_key=${encodeURIComponent(ruleSetKey)}`);
    const j = await r.json();
    setLatest(j?.latest ?? null);
  }

  async function sync() {
    setBusy(true);
    try {
      const r = await fetch(`/api/rules/sba/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
      const j = await r.json();
      await refresh();
      alert(j?.ok ? `Synced. created=${j.created}` : `Error: ${j.error}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { refresh(); }, [ruleSetKey]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Rules Console</h1>
        <select className="border rounded px-2 py-1" value={ruleSetKey} onChange={(e) => setRuleSetKey(e.target.value)}>
          <option value="SBA_CTC_DEFAULTS">SBA_CTC_DEFAULTS</option>
          <option value="SBA_7A_ELIGIBILITY">SBA_7A_ELIGIBILITY</option>
        </select>
        <button className="border rounded px-3 py-1" onClick={refresh}>Refresh</button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded p-3">
          <div className="font-medium mb-2">Latest Version</div>
          <pre className="text-xs whitespace-pre-wrap">{latest ? JSON.stringify(latest, null, 2) : "None yet."}</pre>
        </div>

        <div className="border rounded p-3">
          <div className="font-medium mb-2">Manual Sync Payload</div>
          <textarea className="w-full h-64 border rounded p-2 text-xs" value={payload} onChange={(e) => setPayload(e.target.value)} />
          <button disabled={busy} className="mt-2 border rounded px-3 py-1" onClick={sync}>
            {busy ? "Syncing..." : "Sync Rule Set"}
          </button>
        </div>
      </div>
    </div>
  );
}
