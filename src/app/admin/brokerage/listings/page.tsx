import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { brokerageColors as c } from "@/components/brokerage/tokens";

export const dynamic = "force-dynamic";

/**
 * Internal operational dashboard.
 *
 * Spec: SPEC-BROKERAGE-PRODUCTIONIZATION-V1 §Phase 8 + LAUNCH-BLOCKERS-V1 §3.6.
 *
 * Counts with drilldown links. No marketplace UI, no lender UI, no
 * borrower UI. Just enough signal so Buddy ops can see whether intake
 * / OCR / sealing / listings are stuck before real borrowers come
 * through. Each tile links to a filtered detail page where ops can
 * see WHICH deal is stuck and WHY.
 *
 * Access: admin layout already requires super_admin. We do NOT add a
 * second gate here — single source of truth is the layout.
 *
 * Errors: surfaced inline per tile, not swallowed.
 */

type CountRow = {
  label: string;
  value: number;
  href?: string;
  error?: string;
};

async function safeCount(
  fn: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<{ value: number; error?: string }> {
  try {
    const { count, error } = await fn();
    if (error) {
      return { value: 0, error: errorMessage(error) };
    }
    return { value: count ?? 0 };
  } catch (e) {
    return { value: 0, error: errorMessage(e) };
  }
}

function errorMessage(e: unknown): string {
  if (!e) return "unknown_error";
  if (typeof e === "string") return e;
  if (typeof e === "object" && e && "message" in e) {
    return String((e as { message?: unknown }).message ?? "unknown_error");
  }
  return String(e);
}

export default async function AdminBrokerageListingsPage() {
  let brokerageBankId: string | null = null;
  let tenantError: string | null = null;
  try {
    brokerageBankId = await getBrokerageBankId();
  } catch (e) {
    tenantError = errorMessage(e);
  }

  const sb = supabaseAdmin();
  const since24h = new Date(new Date().valueOf() - 24 * 3600 * 1000).toISOString();

  const counts: CountRow[] = [];

  counts.push({
    label: "Borrower sessions last 24h",
    href: "/admin/brokerage/sessions",
    ...(await safeCount(() =>
      sb
        .from("borrower_session_tokens")
        .select("token_hash", { count: "exact", head: true })
        .gte("created_at", since24h)
        .then((r: any) => ({ count: r.count, error: r.error })),
    )),
  });

  if (brokerageBankId) {
    counts.push({
      label: "Draft brokerage deals (pre-email)",
      href: "/admin/brokerage/deals?origin=brokerage_anonymous",
      ...(await safeCount(() =>
        sb
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("bank_id", brokerageBankId!)
          .eq("origin", "brokerage_anonymous")
          .then((r: any) => ({ count: r.count, error: r.error })),
      )),
    });
    counts.push({
      label: "Claimed brokerage deals",
      href: "/admin/brokerage/deals?origin=brokerage_claimed",
      ...(await safeCount(() =>
        sb
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("bank_id", brokerageBankId!)
          .eq("origin", "brokerage_claimed")
          .then((r: any) => ({ count: r.count, error: r.error })),
      )),
    });
  }

  counts.push({
    label: "Uploads pending OCR",
    href: "/admin/brokerage/uploads",
    ...(await safeCount(() =>
      sb
        .from("deal_documents")
        .select("id", { count: "exact", head: true })
        .is("finalized_at", null)
        .then((r: any) => ({ count: r.count, error: r.error })),
    )),
  });

  counts.push({
    label: "Sealed packages (active)",
    href: "/admin/brokerage/packages",
    ...(await safeCount(() =>
      sb
        .from("buddy_sealed_packages")
        .select("id", { count: "exact", head: true })
        .is("unsealed_at", null)
        .then((r: any) => ({ count: r.count, error: r.error })),
    )),
  });

  counts.push({
    label: "Marketplace listings — previewing",
    ...(await safeCount(() =>
      sb
        .from("marketplace_listings")
        .select("id", { count: "exact", head: true })
        .eq("status", "previewing")
        .then((r: any) => ({ count: r.count, error: r.error })),
    )),
  });

  counts.push({
    label: "Marketplace listings — claiming",
    ...(await safeCount(() =>
      sb
        .from("marketplace_listings")
        .select("id", { count: "exact", head: true })
        .eq("status", "claiming")
        .then((r: any) => ({ count: r.count, error: r.error })),
    )),
  });

  counts.push({
    label: "Marketplace listings — picked",
    ...(await safeCount(() =>
      sb
        .from("marketplace_listings")
        .select("id", { count: "exact", head: true })
        .eq("status", "picked")
        .then((r: any) => ({ count: r.count, error: r.error })),
    )),
  });

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      {tenantError && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          Brokerage tenant unavailable: <code>{tenantError}</code>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {counts.map((row) => {
          const inner = (
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 14, height: "100%" }}>
              <div style={{ fontSize: 11, color: c.textSecondary, letterSpacing: 0.3 }}>{row.label}</div>
              {row.error ? (
                <div style={{ marginTop: 8, fontSize: 11, color: c.brick, wordBreak: "break-all" }}>error: {row.error}</div>
              ) : (
                <div style={{ fontFamily: "var(--font-brokerage-mono)", fontWeight: 600, fontSize: 26, color: c.paper, marginTop: 8 }}>
                  {row.value}
                </div>
              )}
            </div>
          );
          return row.href ? (
            <Link key={row.label} href={row.href} style={{ textDecoration: "none", color: "inherit" }}>
              {inner}
            </Link>
          ) : (
            <div key={row.label}>{inner}</div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: c.textFaint, marginTop: 24 }}>
        Tenant: <code>{brokerageBankId ?? "(unresolved)"}</code>
      </p>
    </div>
  );
}
