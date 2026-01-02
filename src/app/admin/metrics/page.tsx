import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { redirect } from "next/navigation";
import { getMetrics } from "@/lib/admin/metrics";
import { MetricChart } from "@/components/admin/MetricChart";

export const dynamic = "force-dynamic";

export default async function AdminMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: "24h" | "7d" }>;
}) {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;
  const range = params.range === "7d" ? "7d" : "24h";
  const metrics = await getMetrics(range);

  return (
    <div className="p-8 space-y-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin Metrics</h1>
        <div className="flex gap-2">
          <a
            href="?range=24h"
            className={`rounded px-3 py-1 text-sm ${
              range === "24h" ? "bg-white/20" : "bg-white/10"
            }`}
          >
            24h
          </a>
          <a
            href="?range=7d"
            className={`rounded px-3 py-1 text-sm ${
              range === "7d" ? "bg-white/20" : "bg-white/10"
            }`}
          >
            7d
          </a>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 p-4">
          <div className="text-sm text-white/60">AI Calls</div>
          <div className="text-3xl font-semibold">{metrics.totals.ai}</div>
        </div>
        <div className="rounded-xl border border-white/10 p-4">
          <div className="text-sm text-white/60">Errors</div>
          <div className="text-3xl font-semibold">{metrics.totals.errors}</div>
        </div>
        <div className="rounded-xl border border-white/10 p-4">
          <div className="text-sm text-white/60">Rate Limits</div>
          <div className="text-3xl font-semibold">{metrics.totals.rateLimits}</div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <MetricChart data={metrics.timeseries.ai} label="AI Usage" />
        <MetricChart data={metrics.timeseries.errors} label="Errors" />
        <MetricChart data={metrics.timeseries.rateLimits} label="Rate Limits" />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 p-4">
          <h3 className="mb-2 text-sm font-medium text-white/80">
            AI Usage by Action
          </h3>
          <pre className="text-xs">
            {JSON.stringify(metrics.breakdowns.aiByAction, null, 2)}
          </pre>
        </div>

        <div className="rounded-xl border border-white/10 p-4">
          <h3 className="mb-2 text-sm font-medium text-white/80">
            Errors by Action
          </h3>
          <pre className="text-xs">
            {JSON.stringify(metrics.breakdowns.errorByAction, null, 2)}
          </pre>
        </div>
      </section>
    </div>
  );
}

