"use client";

import * as React from "react";
import { ToastProvider, useToast } from "@/components/portal/toast/ToastProvider";
import { ConfettiBurst } from "@/components/portal/fun/ConfettiBurst";

export default function OwnerPortalShell({ params }: { params: Promise<{ token: string }> }) {
  return (
    <ToastProvider>
      <OwnerPortal params={params} />
    </ToastProvider>
  );
}

function OwnerPortal({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = React.useState<string | null>(null);
  const { toast } = useToast();

  const [data, setData] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [burst, setBurst] = React.useState(false);
  const prevPct = React.useRef<number>(-1);

  React.useEffect(() => {
    params.then((p) => setToken(p.token));
  }, [params]);

  async function load() {
    if (!token) return;
    setError(null);
    const res = await fetch(`/api/portal/owner/guided?token=${encodeURIComponent(token)}`);
    const json = await res.json();
    if (!json?.ok) {
      setError(json?.error ?? "Invalid link");
      return;
    }
    setData(json);
  }

  React.useEffect(() => {
    if (token) {
      load();
      const t = window.setInterval(load, 9000);
      return () => window.clearInterval(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  React.useEffect(() => {
    if (!data?.progress) return;
    const pct = Number(data.progress.percent ?? 0);
    if (prevPct.current >= 0 && pct > prevPct.current) {
      toast({ title: "Nice! ✅", detail: `Progress is now ${pct}%` });
      setBurst(true);
      window.setTimeout(() => setBurst(false), 50);
    }
    if (prevPct.current < 100 && pct >= 100) {
      toast({ title: "All set 🎉", detail: "We've received everything we need from you." });
      setBurst(true);
      window.setTimeout(() => setBurst(false), 50);
    }
    prevPct.current = pct;
  }, [data, toast]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-2xl border bg-white p-5">
          <div className="text-lg font-semibold">This link isn't available</div>
          <div className="mt-2 text-sm text-gray-600">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return <div className="p-6 text-sm text-gray-600">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <ConfettiBurst fire={burst} />

      <div className="rounded-2xl border bg-white p-5">
        <div className="text-xs text-gray-500">Owner Portal</div>
        <div className="mt-1 text-lg font-semibold">Hi {data.owner?.full_name ?? "there"} 👋</div>
        <div className="mt-2 text-sm text-gray-600">
          This is a short personal checklist. Upload what you have — we'll guide you the rest of the way.
        </div>

        <div className="mt-4 rounded-xl border bg-gray-50 px-4 py-3">
          <div className="text-xs text-gray-500">Progress</div>
          <div className="mt-1 text-sm font-semibold">
            {data.progress.requiredDone} / {data.progress.requiredTotal} complete
          </div>
          <div className="mt-2 h-2 w-64 overflow-hidden rounded-full bg-gray-200">
            <div className="h-2 rounded-full bg-gray-900" style={{ width: `${data.progress.percent}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-5">
        <div className="text-base font-semibold">Your checklist</div>
        <div className="mt-3 space-y-2">
          {(data.checklist ?? []).map((i: any) => (
            <div key={i.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{i.title}</div>
                  {i.description ? <div className="mt-1 text-sm text-gray-600">{i.description}</div> : null}
                </div>
                <span className="rounded-full border bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700">
                  {i.status === "missing" ? "Missing" : "Received ✅"}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border bg-gray-50 p-4">
          <div className="text-sm font-semibold">Upload</div>
          <div className="mt-1 text-sm text-gray-600">Drag & drop (or click). We'll auto-check items as we receive them.</div>
          <div className="mt-3 rounded-lg border bg-white p-6 text-sm text-gray-500">
            Dropzone placeholder — wire your existing upload UI here, but pass owner token to server route.
          </div>
        </div>
      </div>
    </div>
  );
}
