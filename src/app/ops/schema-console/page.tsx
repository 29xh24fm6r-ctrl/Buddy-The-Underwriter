"use client";

import * as React from "react";

export default function SchemaConsolePage() {
  const [data, setData] = React.useState<any>(null);
  const [active, setActive] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const disc = await fetch("/api/admin/schema/discover").then((r) => r.json());
      if (!disc?.ok) throw new Error(disc?.error ?? "discover failed");
      setData(disc);

      // try to auto activate if none
      const act = await fetch("/api/admin/schema/activate-doc-text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }).then(
        (r) => r.json()
      );
      if (act?.ok) setActive(act.active);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="text-xl font-semibold">Schema Console</div>
      <div className="mt-1 text-sm text-gray-600">Auto-discovers where OCR text/checklists/receipts live.</div>

      {error ? <div className="mt-3 rounded-xl border bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

      <div className="mt-4 rounded-2xl border bg-white p-5">
        <div className="text-base font-semibold">Active doc-text mapping</div>
        <pre className="mt-3 overflow-auto rounded-xl border bg-gray-50 p-3 text-xs">{JSON.stringify(active, null, 2)}</pre>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card title="Doc text candidates" items={data?.docText} />
        <Card title="Receipt candidates" items={data?.receipt} />
        <Card title="Checklist candidates" items={data?.checklist} />
      </div>
    </div>
  );
}

function Card(props: { title: string; items: any[] | undefined }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="text-sm font-semibold">{props.title}</div>
      <div className="mt-3 space-y-2">
        {(props.items ?? []).slice(0, 10).map((x, idx) => (
          <div key={idx} className="rounded-xl border bg-gray-50 p-3 text-xs">
            <div className="font-medium">{x.table}</div>
            <div className="text-gray-600">{x.column}</div>
            <div className="text-gray-500">score: {x.score}</div>
          </div>
        ))}
        {(!props.items || props.items.length === 0) ? <div className="text-xs text-gray-500">None found.</div> : null}
      </div>
    </div>
  );
}
