"use client";

import * as React from "react";

type GuardResult = {
  dealId: string;
  severity: "BLOCKED" | "WARN" | "READY";
  issues: Array<{
    code: string;
    severity: "BLOCKED" | "WARN";
    title: string;
    detail: string;
    fix: { label: string; target: { kind: string; dealId: string } };
  }>;
  stats: { blockedCount: number; warnCount: number };
};

function routeForFixTarget(target: { kind: string; dealId: string }) {
  // Keep this canonical + compatible with your evolving routes.
  // These are safe defaults; adjust paths later if you want prettier deep-links.
  switch (target.kind) {
    case "banker_loan_products":
      return `/deals/${target.dealId}/cockpit`; // card lives on cockpit
    case "borrower_portal_request":
      return `/deals/${target.dealId}/cockpit`; // you can also link to "Portal" tab if you have one
    case "documents_upload":
      return `/deals/${target.dealId}/cockpit`; // upload box usually on cockpit
    default:
      return `/deals/${target.dealId}/cockpit`;
  }
}

export function UnderwriteGuardBanner(props: { dealId: string; bankerUserId: string }) {
  const [loading, setLoading] = React.useState(true);
  const [guard, setGuard] = React.useState<GuardResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/banker/deals/${props.dealId}/underwrite/guard`, {
        method: "GET",
        headers: { "x-user-id": props.bankerUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load underwrite guard");
      setGuard(json.guard ?? null);
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
  }, [props.dealId]);

  if (loading && !guard) {
    return <div className="rounded-xl border bg-white p-3 text-sm text-gray-600">Checking underwriting readiness…</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Underwrite guard error: {error}
      </div>
    );
  }

  if (!guard) return null;

  const tone =
    guard.severity === "READY"
      ? "border-green-200 bg-green-50 text-green-800"
      : guard.severity === "WARN"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-red-200 bg-red-50 text-red-800";

  const headline =
    guard.severity === "READY"
      ? "Underwrite: READY"
      : guard.severity === "WARN"
      ? `Underwrite: WARN (${guard.stats.warnCount})`
      : `Underwrite: BLOCKED (${guard.stats.blockedCount})`;

  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{headline}</div>
          <div className="mt-1 text-xs opacity-80">
            Deterministic guard using borrower requests + banker draft + extracted doc facts.
          </div>
        </div>

        <button className="rounded-md border bg-white/60 px-2 py-1 text-xs hover:bg-white" onClick={load}>
          Refresh
        </button>
      </div>

      {guard.severity !== "READY" ? (
        <div className="mt-3 space-y-2">
          {guard.issues.slice(0, 5).map((i) => (
            <div key={i.code} className="rounded-lg border bg-white/60 p-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{i.title}</div>
                  <div className="mt-1 text-xs opacity-80">{i.detail}</div>
                </div>
                <a
                  className="shrink-0 rounded-md border bg-white px-2 py-1 text-xs font-medium hover:bg-gray-50"
                  href={routeForFixTarget(i.fix.target)}
                >
                  {i.fix.label}
                </a>
              </div>
            </div>
          ))}
          {guard.issues.length > 5 ? (
            <div className="text-xs opacity-80">+ {guard.issues.length - 5} more…</div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border bg-white/60 p-2 text-sm">
          All required underwriting inputs are present. You can proceed to analysis and memo generation.
        </div>
      )}
    </div>
  );
}
