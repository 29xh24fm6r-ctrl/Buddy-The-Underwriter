// src/components/home/CommandBridgeV3.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { launchEvidence } from "@/lib/evidence/launchEvidence";
import { launchPdfOverlay } from "@/lib/evidence/launchPdfOverlay";

type BridgeData = {
  bankId: string;
  stats: { activeDeals: number; needsAttention: number; newUploads: number };
  deals: Array<{ id: string; name: string; status: string; updated_at: string }>;
  feed: Array<{
    id: string;
    created_at: string;
    severity: "info" | "warn" | "success" | "danger";
    title: string;
    message: string | null;
    deal_id: string | null;
    file_id: string | null;
    citation_id: string | null;
    global_char_start: number | null;
    global_char_end: number | null;
    page: number | null;
    icon: string | null;
    meta: any;
  }>;
  nextBestAction: {
    title: string;
    why: Array<{
      text: string;
      dealId?: string | null;
      fileId?: string | null;
      citationId?: string | null;
      globalCharStart?: number | null;
      globalCharEnd?: number | null;
      page?: number | null;
      overlayId?: string | null;
    }>;
    primaryCta: { label: string; href: string };
  };
  health: { ocr: string; evidence: string; portal: string; queueDepth: number };
};

export function CommandBridgeV3(props: { bankId: string; bankName: string }) {
  const { bankId, bankName } = props;

  const [data, setData] = useState<BridgeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch(`/api/home/command-bridge?bankId=${encodeURIComponent(bankId)}`, { cache: "no-store" });
        const json = (await res.json()) as BridgeData;
        if (!alive) return;
        setData(json);
      } catch {
        if (!alive) return;
        setData(null);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }
    run();
    const t = setInterval(run, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bankId]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="lg:col-span-8 space-y-6">
        <UnderwritingRadarHero bankName={bankName} loading={loading} stats={data?.stats} health={data?.health} />
        <NextBestActionBar loading={loading} nba={data?.nextBestAction} />
        <DealTiles loading={loading} deals={data?.deals ?? []} />
      </div>

      <div className="lg:col-span-4">
        <div className="sticky top-6 space-y-6">
          <LiveIntelFeed loading={loading} feed={data?.feed ?? []} />
          <InstantCapture />
        </div>
      </div>
    </div>
  );
}

function UnderwritingRadarHero(props: {
  bankName: string;
  loading: boolean;
  stats?: BridgeData["stats"];
  health?: BridgeData["health"];
}) {
  const { bankName, loading, stats, health } = props;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
      <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs text-slate-300">Underwriting Radar</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Command Bridge</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-200">
            Buddy is extracting evidence, monitoring borrower progress, and surfacing the next decisive credit action.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Chip label={bankName} />
            <Chip label={loading ? "Syncing…" : "Live"} tone={loading ? "neutral" : "good"} />
            <Chip label={`OCR: ${health?.ocr ?? "—"}`} tone="neutral" />
            <Chip label={`Evidence: ${health?.evidence ?? "—"}`} tone="neutral" />
            <Chip label={`Portal: ${health?.portal ?? "—"}`} tone="neutral" />
            <Chip label={`Queue: ${health?.queueDepth ?? 0}`} tone={(health?.queueDepth ?? 0) > 0 ? "warn" : "good"} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/deals/new"
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            Start Underwriting
          </Link>
          <Link
            href="/evidence/inbox"
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            Evidence Inbox
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RadarStat label="Active deals" value={loading ? "—" : String(stats?.activeDeals ?? 0)} />
        <RadarStat label="Needs attention" value={loading ? "—" : String(stats?.needsAttention ?? 0)} tone="warn" />
        <RadarStat label="New uploads" value={loading ? "—" : String(stats?.newUploads ?? 0)} tone="good" />
      </div>
    </section>
  );
}

function NextBestActionBar(props: { loading: boolean; nba?: BridgeData["nextBestAction"] }) {
  const nba = props.nba;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs text-slate-300">Next best action</div>
          <div className="mt-1 text-base font-semibold text-white">
            {props.loading ? "Buddy is deciding…" : (nba?.title ?? "Start underwriting a new deal")}
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {props.loading
              ? <WhyChip text="Loading signals…" />
              : (nba?.why ?? []).slice(0, 5).map((w, i) => (
                  <WhyChip
                    key={i}
                    text={w.text}
                    onClick={() => {
                      // Use new PDF overlay launcher if we have page info
                      if (w.dealId && w.fileId && typeof w.page === "number") {
                        launchPdfOverlay({
                          dealId: w.dealId,
                          fileId: w.fileId,
                          page: w.page,
                          overlayId: w.overlayId ?? null,
                          globalCharStart: w.globalCharStart ?? null,
                          globalCharEnd: w.globalCharEnd ?? null,
                          citationId: w.citationId ?? null,
                          source: "bridge_nba",
                        });
                      } else {
                        // Fallback to old launcher
                        launchEvidence({
                          dealId: w.dealId ?? null,
                          fileId: w.fileId ?? null,
                          citationId: w.citationId ?? null,
                          globalCharStart: w.globalCharStart ?? null,
                          globalCharEnd: w.globalCharEnd ?? null,
                          viewerHref: w.dealId ? `/deals/${w.dealId}` : null,
                          source: "bridge_nba",
                        });
                      }
                    }}
                  />
                ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={nba?.primaryCta.href ?? "/deals/new"}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            {nba?.primaryCta.label ?? "Start Underwriting"} →
          </Link>
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
        </div>
      </div>
    </section>
  );
}

function DealTiles(props: { loading: boolean; deals: BridgeData["deals"] }) {
  const { deals, loading } = props;
  const tiles = useMemo(() => deals.slice(0, 6), [deals]);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Living cases</h2>
        <Link href="/deals" className="text-xs text-slate-200 hover:text-white">View all →</Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[140px] animate-pulse rounded-2xl border border-white/10 bg-black/10" />
          ))
        ) : tiles.length ? (
          tiles.map((d) => <DealTile key={d.id} deal={d} />)
        ) : (
          <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/10 p-6">
            <div className="text-sm font-semibold text-white">No deals yet</div>
            <div className="mt-1 text-sm text-slate-200">
              Start your first underwriting case and Buddy will build the evidence plan automatically.
            </div>
            <Link href="/deals/new" className="mt-4 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100">
              Start Underwriting →
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function DealTile({ deal }: { deal: BridgeData["deals"][number] }) {
  const stage = inferStage(deal.status);
  const heat = inferHeat(deal.status);

  return (
    <Link
      href={`/deals/${deal.id}`}
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/10 p-5 hover:bg-white/5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate">{deal.name ?? `Deal ${deal.id}`}</div>
          <div className="mt-1 text-xs text-slate-300">{stage} • {prettyStatus(deal.status)}</div>
        </div>
        <span className={["rounded-full px-2 py-1 text-[11px] border", heat.className].join(" ")}>
          {heat.label}
        </span>
      </div>

      <div className="mt-4">
        <Timeline stage={stage} />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-slate-300">Updated {timeAgo(deal.updated_at)}</span>
        <span className="text-sm font-semibold text-white/90 group-hover:text-white">Continue →</span>
      </div>

      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute -right-20 -top-20 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
      </div>
    </Link>
  );
}

function LiveIntelFeed(props: { loading: boolean; feed: BridgeData["feed"] }) {
  const { loading, feed } = props;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Live Intelligence</h2>
        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-slate-200">
          click to evidence
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-xl border border-white/10 bg-black/10" />
          ))
        ) : feed.length ? (
          feed.slice(0, 10).map((e) => <IntelRow key={e.id} e={e} />)
        ) : (
          <div className="rounded-xl border border-white/10 bg-black/10 px-4 py-4 text-sm text-slate-200">
            No events yet. As borrowers upload and Buddy processes evidence, you'll see live signals here.
          </div>
        )}
      </div>
    </section>
  );
}

function IntelRow({ e }: { e: BridgeData["feed"][number] }) {
  const tone =
    e.severity === "danger" ? "border-rose-500/25" :
    e.severity === "warn" ? "border-amber-500/25" :
    e.severity === "success" ? "border-emerald-500/25" :
    "border-white/10";

  const icon = e.icon ?? (e.severity === "danger" ? "⛔" : e.severity === "warn" ? "⚠️" : e.severity === "success" ? "✅" : "🧠");

  const clickableEvidence =
    typeof e.global_char_start === "number" &&
    typeof e.global_char_end === "number" &&
    e.global_char_end > e.global_char_start;
  
  const overlayId = e.meta?.overlay_id ?? null;
  const page = typeof e.meta?.page === "number" ? e.meta.page : e.page;

  return (
    <button
      type="button"
      className={["w-full text-left rounded-xl border bg-black/10 px-4 py-3 hover:bg-white/5", tone].join(" ")}
      onClick={() => {
        if (clickableEvidence) {
          // Use new PDF overlay launcher if we have page info
          if (e.deal_id && e.file_id && typeof page === "number") {
            launchPdfOverlay({
              dealId: e.deal_id,
              fileId: e.file_id,
              page: page,
              overlayId: overlayId,
              globalCharStart: e.global_char_start,
              globalCharEnd: e.global_char_end,
              citationId: e.citation_id,
              source: "bridge_feed",
            });
          } else {
            // Fallback to old launcher
            launchEvidence({
              dealId: e.deal_id,
              fileId: e.file_id,
              citationId: e.citation_id,
              globalCharStart: e.global_char_start,
              globalCharEnd: e.global_char_end,
              viewerHref: e.deal_id ? `/deals/${e.deal_id}` : null,
              source: "bridge_feed",
            });
          }
        } else if (e.deal_id) {
          window.location.href = `/deals/${e.deal_id}`;
        }
      }}
      title={clickableEvidence ? "Open exact evidence excerpt" : "Open deal"}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-lg">{icon}</div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{e.title}</div>
          {e.message ? <div className="mt-1 text-sm text-slate-200">{e.message}</div> : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-300">{timeAgo(e.created_at)}</span>
            {clickableEvidence ? (
              <span className="text-xs text-slate-200">Open evidence →</span>
            ) : e.deal_id ? (
              <span className="text-xs text-slate-200">Open deal →</span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function InstantCapture() {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-sm font-semibold text-white">Instant Capture</h2>
      <p className="mt-2 text-sm text-slate-200">
        Capture notes in seconds. Buddy structures them into underwriting-ready evidence.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-2">
        <Link href="/capture/note" className="rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-white hover:bg-white/5">
          📝 Start call note →
        </Link>
        <Link href="/capture/voice" className="rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-white hover:bg-white/5">
          🎙️ Start voice capture →
        </Link>
        <Link href="/capture/discovery" className="rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-white hover:bg-white/5">
          🧠 Borrower discovery →
        </Link>
      </div>
    </section>
  );
}

// ---- small primitives ----
function Chip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "good" | "warn" }) {
  const cls =
    tone === "good" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100" :
    tone === "warn" ? "border-amber-500/25 bg-amber-500/10 text-amber-100" :
    "border-white/10 bg-black/20 text-slate-200";
  return <span className={["rounded-full border px-3 py-1 text-xs", cls].join(" ")}>{label}</span>;
}

function WhyChip({ text, onClick }: { text: string; onClick?: () => void }) {
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full border px-3 py-1 text-xs",
        clickable
          ? "border-white/10 bg-black/20 text-slate-200 hover:bg-white/10 hover:text-white"
          : "border-white/10 bg-black/20 text-slate-200",
      ].join(" ")}
      title={clickable ? "Open supporting evidence" : undefined}
    >
      {text}
    </button>
  );
}

function RadarStat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const cls =
    tone === "good" ? "border-emerald-500/25 bg-emerald-500/10" :
    tone === "warn" ? "border-amber-500/25 bg-amber-500/10" :
    "border-white/10 bg-black/10";
  return (
    <div className={["rounded-xl border px-4 py-3", cls].join(" ")}>
      <div className="text-xs text-slate-300">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function Timeline({ stage }: { stage: string }) {
  const steps = ["Intake", "Docs", "Analysis", "Memo", "Decision"];
  const idx = Math.max(0, steps.findIndex((s) => s === stage));
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={["h-2.5 w-2.5 rounded-full border", i <= idx ? "border-white/30 bg-white/60" : "border-white/15 bg-white/5"].join(" ")} />
          {i < steps.length - 1 ? <div className="h-px w-8 bg-white/10" /> : null}
        </div>
      ))}
    </div>
  );
}

function inferStage(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("intake")) return "Intake";
  if (s.includes("doc")) return "Docs";
  if (s.includes("analysis") || s.includes("underwrite")) return "Analysis";
  if (s.includes("memo")) return "Memo";
  if (s.includes("decision") || s.includes("approved") || s.includes("declined")) return "Decision";
  return "Docs";
}

function inferHeat(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("needs") || s.includes("missing") || s.includes("attention")) {
    return { label: "Hot", className: "border-amber-500/30 bg-amber-500/10 text-amber-100" };
  }
  if (s.includes("ready") || s.includes("complete")) {
    return { label: "Ready", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" };
  }
  return { label: "Active", className: "border-white/10 bg-black/20 text-slate-200" };
}

function prettyStatus(status: string) {
  return status ? status.replaceAll("_", " ") : "active";
}

function timeAgo(iso: string) {
  try {
    const d = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - d);
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    const days = Math.floor(h / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}
