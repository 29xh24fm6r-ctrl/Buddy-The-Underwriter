import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const dynamic = "force-dynamic";

/**
 * /admin/brokerage — Buddy Brokerage command center home.
 *
 * This is the front door for running the brokerage business day to day.
 * Before this page existed, every brokerage-specific screen (lenders,
 * listings ops, comms, deals-by-origin, launch readiness, the owner
 * command center) was reachable only by typing its URL directly — none
 * of them were linked from any nav. The comms page's own breadcrumb
 * pointed at "/admin/brokerage" and 404'd, because nothing served it.
 *
 * This page fixes that: one place that links out to every real,
 * working piece of the brokerage operation, grouped by how they're
 * actually used (work deals day-to-day vs. monitor ops health vs.
 * manage the business).
 *
 * Access: admin layout already requires super_admin. We do NOT add a
 * second gate here — single source of truth is the layout.
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

export default async function BrokerageHomePage() {
  let brokerageBankId: string | null = null;
  let tenantError: string | null = null;
  try {
    brokerageBankId = await getBrokerageBankId();
  } catch (e) {
    tenantError = errorMessage(e);
  }

  const sb = supabaseAdmin();

  const [activeDeals, lendersLoaded, uploadsStuck, sealedPackages] =
    await Promise.all([
      brokerageBankId
        ? safeCount(() =>
            sb
              .from("deals")
              .select("id", { count: "exact", head: true })
              .eq("bank_id", brokerageBankId!)
              .then((r: any) => ({ count: r.count, error: r.error })),
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
    <main className="px-8 py-10 max-w-6xl mx-auto">
      <header className="mb-8">
        <div className="text-xs uppercase tracking-wide text-neutral-400">
          Buddy Brokerage
        </div>
        <h1 className="text-3xl font-semibold mt-1">Command center</h1>
        <p className="text-sm text-neutral-400 mt-2 max-w-2xl">
          Everything for running the brokerage business — working deals,
          managing lenders, and keeping an eye on ops health — starts here.
        </p>
      </header>

      {tenantError && (
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4 mb-6">
          Brokerage tenant unavailable: <code>{tenantError}</code>
        </div>
      )}

      {/* ── Do the work ──────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
          Do the work
        </h2>
        <div className="grid gap-4 md:grid-cols-5">
          <Link
            href="/deals"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-lg font-medium">Deals</div>
            <div className="text-sm text-neutral-400 mt-1">
              The working pipeline — intake, documents, underwriting,
              pricing, credit memo, servicing.
            </div>
            <div className="text-2xl font-semibold mt-3">
              {activeDeals ?? "—"}
            </div>
            <div className="text-xs text-neutral-500">active on this tenant</div>
            <div className="text-xs text-amber-400 mt-2">
              Requires the Buddy Brokerage tenant selected — use{" "}
              <span className="underline">/select-bank</span> if you land on
              a different bank.
            </div>
          </Link>

          <Link
            href="/admin/brokerage/lenders"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-lg font-medium">Lenders</div>
            <div className="text-sm text-neutral-400 mt-1">
              Load and manage the banks your brokerage places deals with —
              matching programs, agreements, referral terms.
            </div>
            <div className="text-2xl font-semibold mt-3">
              {lendersLoaded ?? "—"}
            </div>
            <div className="text-xs text-neutral-500">active lender agreements</div>
          </Link>

          <Link
            href="/admin/brokerage-owner"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-lg font-medium">Owner command center</div>
            <div className="text-sm text-neutral-400 mt-1">
              Pipeline summary, daily brief, bottlenecks, team workload, and
              activity feed — the business-level view.
            </div>
          </Link>

          <Link
            href="/admin/brokerage/crm"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-lg font-medium">CRM</div>
            <div className="text-sm text-neutral-400 mt-1">
              Referral sources and professional partners — organizations,
              contacts, and a logged activity timeline per relationship.
            </div>
          </Link>

          <Link
            href="/admin/brokerage/billing"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-lg font-medium">Billing</div>
            <div className="text-sm text-neutral-400 mt-1">
              Invoice lenders for referral fees on funded deals — draft,
              finalize, and track payment.
            </div>
          </Link>
        </div>
      </section>

      {/* ── Ops health ────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
          Ops health
        </h2>
        <div className="grid gap-4 md:grid-cols-4">
          <Link
            href="/admin/brokerage/listings"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-sm font-medium">Listings &amp; sessions</div>
            <div className="text-xs text-neutral-500 mt-1">
              Full ops tile board — sessions, drafts, claimed deals,
              marketplace listing counts.
            </div>
          </Link>
          <Link
            href="/admin/brokerage/uploads"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-sm font-medium">Uploads pending OCR</div>
            <div className="text-2xl font-semibold mt-2">
              {uploadsStuck ?? "—"}
            </div>
          </Link>
          <Link
            href="/admin/brokerage/packages"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-sm font-medium">Sealed packages</div>
            <div className="text-2xl font-semibold mt-2">
              {sealedPackages ?? "—"}
            </div>
            <div className="text-xs text-neutral-500">active, unsealed</div>
          </Link>
          <Link
            href="/admin/brokerage/comms"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-sm font-medium">Communications</div>
            <div className="text-xs text-neutral-500 mt-1">
              Borrower nudges, banker alerts, outbox processing.
            </div>
          </Link>
        </div>
      </section>

      {/* ── Run the business ─────────────────────────────────────── */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
          Run the business
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Link
            href="/admin/roles"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-sm font-medium">Team &amp; roles</div>
            <div className="text-xs text-neutral-500 mt-1">
              Add partners, assign access.
            </div>
          </Link>
          <Link
            href="/admin/brokerage/launch-readiness"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-sm font-medium">Launch readiness</div>
            <div className="text-xs text-neutral-500 mt-1">
              Pilot-readiness checklist — what's real vs. still open before
              a live borrower goes through.
            </div>
          </Link>
          <Link
            href="/admin/brokerage/deals"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors block"
          >
            <div className="text-sm font-medium">Stuck deals (by origin)</div>
            <div className="text-xs text-neutral-500 mt-1">
              Diagnostic view — oldest-first, filterable by anonymous vs.
              claimed.
            </div>
          </Link>
        </div>
      </section>

      <p className="text-xs text-neutral-500 mt-10">
        Tenant: <code>{brokerageBankId ?? "(unresolved)"}</code>
      </p>
    </main>
  );
}
