import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import {
  checkSchemaParity as runSchemaParityCheck,
  type SchemaManifestEntry,
} from "@/lib/admin/schemaParityCheck";

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
  const { data: deals, error } = await sb
    .from("deals")
    .select("id, created_at, is_test")
    .eq("bank_id", brokerageBankId)
    .eq("origin", "brokerage_anonymous")
    .is("brokerage_session_token_hash", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    return {
      id: "orphan_drafts",
      label: "Orphan brokerage drafts after session hardening",
      status: "fail",
      value: `query failed: ${error.message}`,
    };
  }

  const contractStartedAt = Date.parse("2026-06-21T00:00:00.000Z");
  const rows = (deals ?? []) as Array<{
    id: string;
    created_at: string | null;
    is_test: boolean | null;
  }>;
  const synthetic = rows.filter((deal) => deal.is_test === true);
  const productionRows = rows.filter((deal) => deal.is_test !== true);
  const regressions = productionRows.filter((deal) => {
    const createdAt = deal.created_at ? Date.parse(deal.created_at) : Number.NaN;
    return Number.isFinite(createdAt) && createdAt >= contractStartedAt;
  });
  const legacyCount = productionRows.length - regressions.length;
  return {
    id: "orphan_drafts",
    label: "Orphan brokerage drafts after session hardening",
    status: regressions.length === 0 ? "ok" : regressions.length < 5 ? "warn" : "fail",
    value:
      `${regressions.length} production regression(s); ` +
      `${legacyCount} legacy row(s); ${synthetic.length} synthetic row(s) excluded`,
  };
}

async function checkPendingOcr(): Promise<Check> {
  const sb = supabaseAdmin();
  const { data: docs, error } = await sb
    .from("deal_documents")
    .select("id, deal_id, created_at")
    .eq("is_active", true)
    .is("finalized_at", null)
    // Oldest first prevents fresh uploads from hiding long-stalled work.
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) {
    return {
      id: "pending_ocr",
      label: "Uploads pending OCR",
      status: "fail",
      value: `query failed: ${error.message}`,
    };
  }

  const rows = (docs ?? []) as Array<{
    id: string;
    deal_id: string;
    created_at: string | null;
  }>;
  const dealIds = [...new Set(rows.map((row) => row.deal_id).filter(Boolean))];
  const testDealIds = new Set<string>();
  if (dealIds.length > 0) {
    const { data: deals, error: dealError } = await sb
      .from("deals")
      .select("id, is_test")
      .in("id", dealIds);
    if (dealError) {
      return {
        id: "pending_ocr",
        label: "Uploads pending OCR",
        status: "fail",
        value: `deal classification failed: ${dealError.message}`,
      };
    }
    for (const deal of (deals ?? []) as Array<{ id: string; is_test: boolean | null }>) {
      if (deal.is_test === true) testDealIds.add(deal.id);
    }
  }

  const productionRows = rows.filter((row) => !testDealIds.has(row.deal_id));
  const staleBefore = Date.now() - 15 * 60_000;
  const stuck = productionRows.filter((row) => {
    const createdAt = row.created_at ? Date.parse(row.created_at) : Number.NaN;
    return Number.isFinite(createdAt) && createdAt < staleBefore;
  });
  const fresh = productionRows.length - stuck.length;
  const syntheticCount = rows.length - productionRows.length;
  return {
    id: "pending_ocr",
    label: "Uploads pending OCR",
    status: stuck.length === 0 ? "ok" : stuck.length < 10 ? "warn" : "fail",
    value:
      `${stuck.length} stuck production document(s); ${fresh} fresh; ` +
      `${syntheticCount} synthetic excluded`,
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
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("ai_events")
    .select("created_at, action, output_json")
    .eq("scope", "synth_borrower_e2e")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    return {
      id: "synth_borrower_report",
      label: "Synthetic borrower run",
      status: "fail",
      value: `evidence query failed: ${error.message}`,
    };
  }
  const row = (data?.[0] ?? null) as {
    created_at: string;
    action: string;
    output_json: Record<string, unknown> | null;
  } | null;
  if (!row) {
    return {
      id: "synth_borrower_report",
      label: "Synthetic borrower run",
      status: "warn",
      value: "no durable run evidence recorded",
    };
  }
  const output = row.output_json ?? {};
  const passCount = Number(output.pass_count ?? 0);
  const total = Number(output.total ?? 0);
  const repeatViolations = Number(output.repeat_ask_violation_count ?? 0);
  const ageDays = (Date.now() - new Date(row.created_at).getTime()) / 86_400_000;
  const passed =
    row.action === "passed" &&
    passCount >= 13 &&
    total >= 15 &&
    repeatViolations === 0;
  const fresh = Number.isFinite(ageDays) && ageDays <= 7;
  return {
    id: "synth_borrower_report",
    label: "Synthetic borrower run (≤7d old, ≥13/15)",
    status: passed && fresh ? "ok" : passed ? "warn" : "fail",
    value:
      `${passCount}/${total} from ${row.created_at} (${ageDays.toFixed(1)}d ago); ` +
      `repeat violations=${repeatViolations}; action=${row.action}`,
  };
}

async function checkSchemaParity(): Promise<Check> {
  const manifestPath = join(process.cwd(), "scripts/audit/schema-manifest.json");
  let manifest: SchemaManifestEntry[];
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SchemaManifestEntry[];
  } catch (e) {
    return {
      id: "schema_parity",
      label: "Schema parity (manifest vs. live)",
      status: "fail",
      value: `manifest unreadable: ${(e as Error).message}`,
    };
  }
  return runSchemaParityCheck(supabaseAdmin() as never, manifest);
}

async function checkLastCleanupCron(): Promise<Check> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("ai_events")
    .select("created_at, action, output_json")
    .eq("scope", "brokerage_session_cleanup")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    return {
      id: "cleanup_cron",
      label: "Expired-session cleanup CRON",
      status: "fail",
      value: `evidence query failed: ${error.message}`,
    };
  }
  const row = (data?.[0] ?? null) as {
    created_at: string;
    action: string;
    output_json: Record<string, unknown> | null;
  } | null;
  if (!row) {
    return {
      id: "cleanup_cron",
      label: "Expired-session cleanup CRON",
      status: "warn",
      value: "no durable run evidence recorded",
    };
  }
  const ageH = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
  const successful = row.action === "completed";
  return {
    id: "cleanup_cron",
    label: "Expired-session cleanup CRON last run",
    status: !successful ? "fail" : ageH <= 24 ? "ok" : ageH <= 48 ? "warn" : "fail",
    value: `${ageH.toFixed(1)}h ago; action=${row.action}`,
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
    schemaParity,
  ] = await Promise.all([
    checkBrokerageSingleton(),
    checkRlsEnabled(),
    checkBrokerageAnonymousNoCookieAnchor(),
    checkPendingOcr(),
    checkPortalLinkRevokedColumn(),
    checkSyntheticBorrowerReport(),
    checkLastCleanupCron(),
    checkSchemaParity(),
  ]);

  const checks: Check[] = [
    singleton,
    ...rlsChecks,
    portalCol,
    orphans,
    pendingOcr,
    cron,
    synth,
    schemaParity,
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
