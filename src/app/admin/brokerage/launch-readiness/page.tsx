import "server-only";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { brokerageColors as c } from "@/components/brokerage/tokens";

export const dynamic = "force-dynamic";

/**
 * Pilot-readiness checklist. SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.8.
 *
 * Each row asserts one of the pilot-ready invariants. Each row exposes a
 * data-check-id + data-status for snapshot testing. The page does no
 * writes.
 */

type Status = "ok" | "warn" | "fail" | "unknown";

type Check = {
  id: string;
  label: string;
  status: Status;
  value: string;
};

async function checkBrokerageSingleton(): Promise<Check> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("banks")
    .select("id", { count: "exact" })
    .eq("bank_kind", "brokerage");
  if (error) {
    return {
      id: "brokerage_singleton",
      label: "Brokerage singleton",
      status: "fail",
      value: `query failed: ${error.message}`,
    };
  }
  const n = data?.length ?? 0;
  return {
    id: "brokerage_singleton",
    label: "Brokerage singleton",
    status: n === 1 ? "ok" : n === 0 ? "fail" : "fail",
    value: `${n} bank row(s) with bank_kind=brokerage`,
  };
}

async function checkRlsEnabled(): Promise<Check[]> {
  const sb = supabaseAdmin();
  // Audit H4: the prior check did a service-role SELECT — which BYPASSES RLS —
  // so it reported "ok" whenever the table was readable, regardless of whether
  // RLS was actually enabled (a fake green on a GLBA-critical invariant). Now
  // query the real pg state via get_rls_status_for_tables(): RLS is "ok" only
  // when rowsecurity is enabled AND at least one policy exists.
  const tables = ["borrower_session_tokens", "rate_limit_counters"];
  const { data, error } = await sb.rpc("get_rls_status_for_tables", {
    p_table_names: tables,
  });
  if (error) {
    return tables.map((t) => ({
      id: `rls_${t}`,
      label: `RLS — ${t}`,
      status: "fail" as const,
      value: `rls status query failed: ${error.message}`,
    }));
  }
  const byName = new Map(
    ((data ?? []) as any[]).map((r) => [r.table_name, r]),
  );
  return tables.map((t) => {
    const row: any = byName.get(t);
    if (!row) {
      return { id: `rls_${t}`, label: `RLS — ${t}`, status: "fail" as const, value: "table not found" };
    }
    const enabled = row.rls_enabled === true && Number(row.policy_count) > 0;
    return {
      id: `rls_${t}`,
      label: `RLS — ${t}`,
      status: enabled ? ("ok" as const) : ("fail" as const),
      value: `rls_enabled=${row.rls_enabled}, policies=${row.policy_count}`,
    };
  });
}

async function checkBrokerageAnonymousNoCookieAnchor(): Promise<Check> {
  // SPEC §9.2: no duplicate draft deals from session refresh/retry.
  // Surface as: count of brokerage_anonymous deals without a matching
  // session token row.
  let brokerageBankId: string | null = null;
  try {
    brokerageBankId = await getBrokerageBankId();
  } catch (e) {
    return {
      id: "orphan_drafts",
      label: "Orphan drafts (no token row)",
      status: "fail",
      value: `tenant lookup failed: ${(e as Error).message}`,
    };
  }
  const sb = supabaseAdmin();
  const { data: deals } = await sb
    .from("deals")
    .select("id")
    .eq("bank_id", brokerageBankId)
    .eq("origin", "brokerage_anonymous")
    .is("brokerage_session_token_hash", null)
    .limit(20);
  const n = deals?.length ?? 0;
  return {
    id: "orphan_drafts",
    label: "Orphan brokerage_anonymous drafts (NULL token_hash)",
    status: n === 0 ? "ok" : n < 5 ? "warn" : "fail",
    value: `${n} row(s) — should be 0 once migration 20260621000001 has been applied`,
  };
}

async function checkPendingOcr(): Promise<Check> {
  const sb = supabaseAdmin();
  const { count } = await sb
    .from("deal_documents")
    .select("id", { count: "exact", head: true })
    .is("finalized_at", null);
  const n = count ?? 0;
  return {
    id: "pending_ocr",
    label: "Uploads pending OCR",
    status: n === 0 ? "ok" : n < 10 ? "warn" : "fail",
    value: `${n} document(s) with finalized_at IS NULL`,
  };
}

async function checkPortalLinkRevokedColumn(): Promise<Check> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("borrower_portal_links")
    .select("revoked_at")
    .limit(0);
  return {
    id: "portal_link_revoked_at",
    label: "borrower_portal_links.revoked_at present",
    status: error ? "fail" : "ok",
    value: error
      ? `column missing: ${error.message}`
      : "column readable",
  };
}

async function checkSyntheticBorrowerReport(): Promise<Check> {
  const reportPath = join(process.cwd(), ".ci/synth-borrower-e2e-report.json");
  if (!existsSync(reportPath)) {
    return {
      id: "synth_borrower_report",
      label: "Synthetic borrower run",
      status: "warn",
      value: "no report present (.ci/synth-borrower-e2e-report.json missing)",
    };
  }
  try {
    const r = JSON.parse(readFileSync(reportPath, "utf8")) as {
      ran_at: string;
      pass_count: number;
      total: number;
    };
    const ranAtTs = new Date(r.ran_at).getTime();
    const ageDays = (Date.now() - ranAtTs) / 86400000;
    const passOk = r.pass_count >= 13;
    const ageOk = ageDays <= 7;
    return {
      id: "synth_borrower_report",
      label: "Synthetic borrower run (≤7d old, ≥13/15)",
      status: passOk && ageOk ? "ok" : passOk ? "warn" : "fail",
      value: `${r.pass_count}/${r.total} from ${r.ran_at} (${ageDays.toFixed(1)}d ago)`,
    };
  } catch (e) {
    return {
      id: "synth_borrower_report",
      label: "Synthetic borrower run",
      status: "fail",
      value: `report unreadable: ${(e as Error).message}`,
    };
  }
}

async function checkLastCleanupCron(): Promise<Check> {
  // Best-effort: read the most recent ai_events row tagged
  // brokerage_session_cleanup. Falls back gracefully if the scope is
  // absent.
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("ai_events")
    .select("created_at")
    .eq("scope", "brokerage_session_cleanup")
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data?.[0] ?? null) as { created_at: string } | null;
  if (!row) {
    return {
      id: "cleanup_cron",
      label: "Expired-session cleanup CRON",
      status: "warn",
      value: "no recent run recorded",
    };
  }
  const ageH = (Date.now() - new Date(row.created_at).getTime()) / 3600_000;
  return {
    id: "cleanup_cron",
    label: "Expired-session cleanup CRON last run",
    status: ageH <= 24 ? "ok" : ageH <= 48 ? "warn" : "fail",
    value: `${ageH.toFixed(1)}h ago`,
  };
}

export default async function LaunchReadinessPage() {
  const [
    singleton,
    rlsChecks,
    orphans,
    pendingOcr,
    portalCol,
    synth,
    cron,
  ] = await Promise.all([
    checkBrokerageSingleton(),
    checkRlsEnabled(),
    checkBrokerageAnonymousNoCookieAnchor(),
    checkPendingOcr(),
    checkPortalLinkRevokedColumn(),
    checkSyntheticBorrowerReport(),
    checkLastCleanupCron(),
  ]);

  const checks: Check[] = [
    singleton,
    ...rlsChecks,
    portalCol,
    orphans,
    pendingOcr,
    cron,
    synth,
  ];

  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  const readyCount = checks.length - failCount - warnCount;

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ height: 6, flex: 1, background: c.ink, borderRadius: 3, overflow: "hidden", display: "flex" }}>
            <div style={{ height: "100%", width: `${(readyCount / checks.length) * 100}%`, background: c.sage }} />
            <div style={{ height: "100%", width: `${(warnCount / checks.length) * 100}%`, background: c.brassBright }} />
            <div style={{ height: "100%", width: `${(failCount / checks.length) * 100}%`, background: c.brick }} />
          </div>
          <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 11, color: c.textMuted, whiteSpace: "nowrap" }}>
            {readyCount} / {checks.length} ready
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ border: `1px solid rgba(90,138,110,.4)`, background: "rgba(90,138,110,.1)", borderRadius: 8, padding: 12, fontSize: 12 }}>
          <span style={{ color: c.sage, fontFamily: "var(--font-brokerage-mono)", fontWeight: 600 }}>{readyCount}</span>{" "}
          <span style={{ color: c.textSecondary }}>ready</span>
        </div>
        <div style={{ border: `1px solid rgba(184,144,91,.4)`, background: "rgba(184,144,91,.1)", borderRadius: 8, padding: 12, fontSize: 12 }}>
          <span style={{ color: c.brassBright, fontFamily: "var(--font-brokerage-mono)", fontWeight: 600 }}>{warnCount}</span>{" "}
          <span style={{ color: c.textSecondary }}>amber</span>
        </div>
        <div style={{ border: `1px solid rgba(168,93,82,.4)`, background: "rgba(168,93,82,.1)", borderRadius: 8, padding: 12, fontSize: 12 }}>
          <span style={{ color: c.brick, fontFamily: "var(--font-brokerage-mono)", fontWeight: 600 }}>{failCount}</span>{" "}
          <span style={{ color: c.textSecondary }}>red</span>
        </div>
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 100px 1.6fr",
            padding: "9px 16px",
            borderBottom: `1px solid ${c.borderStrong}`,
            background: c.inkHeader,
            fontFamily: "var(--font-brokerage-mono)",
            fontSize: 9.5,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: c.textFaint,
          }}
        >
          <div>Check</div>
          <div>Status</div>
          <div>Value</div>
        </div>
        {checks.map((chk) => (
          <div
            key={chk.id}
            data-check-id={chk.id}
            data-status={chk.status}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 100px 1.6fr",
              padding: "10px 16px",
              borderBottom: `1px solid ${c.divider}`,
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 12, color: c.paper }}>{chk.label}</div>
            <div>
              <StatusBadge status={chk.status} />
            </div>
            <div style={{ fontSize: 11, color: c.textSecondary }}>{chk.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const colors: Record<Status, { text: string; bg: string }> = {
    ok: { text: c.sage, bg: "rgba(90,138,110,.12)" },
    warn: { text: c.brassBright, bg: "rgba(184,144,91,.12)" },
    fail: { text: c.brick, bg: "rgba(168,93,82,.12)" },
    unknown: { text: c.textSecondary, bg: "rgba(154,150,140,.07)" },
  };
  const s = colors[status];
  return (
    <span
      style={{
        display: "inline-flex",
        fontFamily: "var(--font-brokerage-mono)",
        fontSize: 9,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: s.text,
        background: s.bg,
        padding: "3px 7px",
        borderRadius: 2,
      }}
    >
      {status}
    </span>
  );
}
