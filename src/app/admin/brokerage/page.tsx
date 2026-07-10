import "server-only";

import type { ReactNode } from "react";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { brokerageColors as c, fmtMoneyCompact } from "@/components/brokerage/tokens";

export const dynamic = "force-dynamic";

/**
 * /admin/brokerage — Buddy Brokerage command center home.
 *
 * Visual system ported from the Claude Design prototype
 * (Buddy_Brokerage_dc.html): the four-tile "Do the work" row with left
 * accent bars, grouped sections, ink/brass palette. Real data throughout —
 * no sample data carried over from the prototype.
 *
 * Structure unchanged from the pre-redesign version (still fixes the same
 * dead-link/discoverability gap this page was originally built to solve —
 * see git history) — this pass is the visual layer only.
 */

function errorMessage(e: unknown): string {
  if (!e) return "unknown_error";
  if (typeof e === "string") return e;
  if (typeof e === "object" && e && "message" in e) {
    return String((e as { message?: unknown }).message ?? "unknown_error");
  }
  return String(e);
}

async function safeCount(
  fn: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  try {
    const { count, error } = await fn();
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function safeSum(
  fn: () => PromiseLike<{ data: { loan_amount: number | null }[] | null; error: unknown }>,
): Promise<number | null> {
  try {
    const { data, error } = await fn();
    if (error || !data) return null;
    return data.reduce((s, r) => s + (r.loan_amount ?? 0), 0);
  } catch {
    return null;
  }
}

function Tile({
  label,
  value,
  delta,
  accent,
  href,
}: {
  label: string;
  value: string;
  delta: string;
  accent: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        background: c.card,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        padding: "16px 16px 15px",
        position: "relative",
        overflow: "hidden",
        display: "block",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: accent }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, color: c.textSecondary, letterSpacing: 0.3 }}>{label}</div>
      </div>
      <div
        style={{
          fontFamily: "var(--font-brokerage-mono)",
          fontWeight: 600,
          fontSize: 30,
          color: c.paper,
          margin: "9px 0 3px",
          letterSpacing: -0.5,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: c.textMuted }}>{delta}</div>
    </Link>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-brokerage-mono)",
        fontSize: 10,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: c.textMuted,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function SmallCard({
  title,
  desc,
  value,
  href,
}: {
  title: string;
  desc: string;
  value?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        background: c.card,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        padding: 14,
        display: "block",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: c.paper, marginBottom: 4 }}>{title}</div>
      {value && (
        <div style={{ fontFamily: "var(--font-brokerage-mono)", fontWeight: 600, fontSize: 22, color: c.paper, margin: "4px 0" }}>
          {value}
        </div>
      )}
      <div style={{ fontSize: 11, color: c.textMuted, lineHeight: 1.5 }}>{desc}</div>
    </Link>
  );
}

export default async function BrokerageHomePage() {
  let brokerageBankId: string | null = null;
  let tenantError: string | null = null;
  try {
    brokerageBankId = await getBrokerageBankId();
  } catch (e) {
    tenantError = errorMessage(e);
  }

  const sb = supabaseAdmin();

  const [activeDeals, pipelineValue, lendersLoaded, uploadsStuck, sealedPackages] = await Promise.all([
    brokerageBankId
      ? safeCount(() =>
          sb
            .from("deals")
            .select("id", { count: "exact", head: true })
            .eq("bank_id", brokerageBankId!)
            .then((r: any) => ({ count: r.count, error: r.error })),
        )
      : Promise.resolve(null),
    brokerageBankId
      ? safeSum(() =>
          sb
            .from("deals")
            .select("loan_amount")
            .eq("bank_id", brokerageBankId!)
            .then((r: any) => ({ data: r.data, error: r.error })),
        )
      : Promise.resolve(null),
    safeCount(() =>
      sb
        .from("lender_marketplace_agreements")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .then((r: any) => ({ count: r.count, error: r.error })),
    ),
    safeCount(() =>
      sb
        .from("deal_documents")
        .select("id", { count: "exact", head: true })
        .is("finalized_at", null)
        .then((r: any) => ({ count: r.count, error: r.error })),
    ),
    safeCount(() =>
      sb
        .from("buddy_sealed_packages")
        .select("id", { count: "exact", head: true })
        .is("unsealed_at", null)
        .then((r: any) => ({ count: r.count, error: r.error })),
    ),
  ]);

  return (
    <div style={{ padding: "22px 24px 40px", maxWidth: 1240 }}>
      {tenantError && (
        <div
          style={{
            border: `1px solid ${c.brick}`,
            background: "rgba(168,93,82,.1)",
            color: c.brick,
            fontSize: 12,
            padding: 12,
            borderRadius: 6,
            marginBottom: 20,
          }}
        >
          Brokerage tenant unavailable: <code>{tenantError}</code>
        </div>
      )}

      {/* Do the work */}
      <SectionLabel>Do the work</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 26 }}>
        <Tile
          label="Active deals"
          value={activeDeals !== null ? String(activeDeals) : "—"}
          delta={pipelineValue !== null ? `${fmtMoneyCompact(pipelineValue)} in pipeline` : "on this tenant"}
          accent={c.brassBright}
          href="/deals"
        />
        <Tile
          label="Active lenders"
          value={lendersLoaded !== null ? String(lendersLoaded) : "—"}
          delta="active agreements"
          accent={c.brass}
          href="/admin/brokerage/lenders"
        />
        <Tile
          label="Uploads pending OCR"
          value={uploadsStuck !== null ? String(uploadsStuck) : "—"}
          delta="awaiting processing"
          accent={uploadsStuck && uploadsStuck > 0 ? c.brick : c.textFaint}
          href="/admin/brokerage/uploads"
        />
        <Tile
          label="Sealed packages"
          value={sealedPackages !== null ? String(sealedPackages) : "—"}
          delta="active, unsealed"
          accent={c.sage}
          href="/admin/brokerage/packages"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 26 }}>
        <SmallCard title="CRM" desc="Referral sources and professional partners, with a logged activity timeline per relationship." href="/admin/brokerage/crm" />
        <SmallCard title="Billing" desc="Invoice lenders for referral fees on funded deals — draft, finalize, track payment." href="/admin/brokerage/billing" />
        <SmallCard title="Owner command center" desc="Pipeline summary, bottlenecks, team workload, activity feed." href="/admin/brokerage-owner" />
      </div>

      {/* Ops health */}
      <SectionLabel>Ops health</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 26 }}>
        <SmallCard title="Listings & sessions" desc="Full ops tile board — sessions, drafts, claimed deals, marketplace listing counts." href="/admin/brokerage/listings" />
        <SmallCard title="Uploads pending OCR" value={uploadsStuck !== null ? String(uploadsStuck) : "—"} desc="" href="/admin/brokerage/uploads" />
        <SmallCard title="Sealed packages" value={sealedPackages !== null ? String(sealedPackages) : "—"} desc="active, unsealed" href="/admin/brokerage/packages" />
        <SmallCard title="Communications" desc="Borrower nudges, banker alerts, outbox processing." href="/admin/brokerage/comms" />
      </div>

      {/* Run the business */}
      <SectionLabel>Run the business</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <SmallCard title="Team & roles" desc="Add partners, assign access." href="/admin/brokerage/team" />
        <SmallCard title="Launch readiness" desc="Pilot-readiness checklist — what's real vs. still open before a live borrower goes through." href="/admin/brokerage/launch-readiness" />
        <SmallCard title="Stuck deals (by origin)" desc="Diagnostic view — oldest-first, filterable by anonymous vs. claimed." href="/admin/brokerage/deals" />
      </div>

      <p style={{ fontSize: 11, color: c.textFaint, marginTop: 32 }}>
        Tenant: <code>{brokerageBankId ?? "(unresolved)"}</code>
      </p>
    </div>
  );
}
