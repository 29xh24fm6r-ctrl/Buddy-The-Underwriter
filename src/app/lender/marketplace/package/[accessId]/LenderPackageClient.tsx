"use client";

import * as React from "react";

export function LenderPackageClient({ accessId }: { accessId: string }) {
  const [pkg, setPkg] = React.useState<Record<string, unknown> | null>(null);
  const [accessLevel, setAccessLevel] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/lender/marketplace/package/${accessId}`, { cache: "no-store" });
        if (res.status === 404) throw new Error("no_access");
        const json = await res.json();
        if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setPkg(json.package ?? null);
        setAccessLevel(json.accessLevel ?? null);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, [accessId]);

  if (loading) return <div className="p-8 text-sm text-neutral-500">Loading package…</div>;

  if (err) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Loan package</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {err === "no_access"
            ? "You do not have access to this package. Access is granted only after the borrower selects your institution."
            : `Could not load package: ${err}`}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-semibold">Loan package</h1>
      <p className="mt-1 text-xs text-neutral-500">Access level: {accessLevel ?? "—"}</p>
      <pre className="mt-4 max-h-[70vh] overflow-auto rounded-lg bg-neutral-50 p-4 text-xs">
        {JSON.stringify(pkg, null, 2)}
      </pre>
    </div>
  );
}
