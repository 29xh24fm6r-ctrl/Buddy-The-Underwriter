// src/components/ops/reminders/SubscriptionDetail.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RunFeed, { ReminderRun } from "@/components/ops/reminders/RunFeed";
import RunDetails from "@/components/ops/reminders/RunDetails";

type AnyObj = Record<string, any>;

export default function SubscriptionDetail({ subscriptionId }: { subscriptionId: string }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<AnyObj | null>(null);
  const [runs, setRuns] = useState<ReminderRun[]>([]);
  const [selected, setSelected] = useState<ReminderRun | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(`/api/admin/reminders/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setErr(json?.error || "Failed to load");
        setLoading(false);
        return;
      }

      setSubscription(json.subscription ?? null);
      setRuns((json.runs ?? []) as ReminderRun[]);
      setLoading(false);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionId]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-sm text-slate-600">Loading subscription…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="p-6 space-y-3">
        <Link href="/ops/reminders/war-room" className="text-sm underline">
          ← Back to War Room
        </Link>
        <div className="text-red-700 text-sm">Error: {err}</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-screen">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-2xl font-semibold">Reminder Subscription</div>
          <div className="text-sm text-slate-600 break-all">{subscriptionId}</div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/ops/reminders/war-room?mode=grafana"
            className="px-3 py-2 rounded-xl text-xs font-semibold border bg-white hover:bg-slate-50"
          >
            War Room
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm p-4">
        <div className="text-sm font-semibold">Subscription record</div>
        <pre className="mt-2 text-xs overflow-auto p-3 rounded-xl bg-slate-50 border">
          {JSON.stringify(subscription, null, 2)}
        </pre>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RunFeed
          mode="grafana"
          runs={runs}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
        />
        <RunDetails mode="grafana" run={selected} />
      </div>
    </div>
  );
}
