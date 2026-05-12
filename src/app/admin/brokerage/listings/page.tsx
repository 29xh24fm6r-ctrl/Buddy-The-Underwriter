import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const dynamic = "force-dynamic";

/**
 * Internal operational dashboard stub.
 *
 * Spec: SPEC-BROKERAGE-PRODUCTIONIZATION-V1 §Phase 8.
 *
 * Counts only. No marketplace UI, no lender UI, no borrower UI. Just
 * enough signal so Buddy ops can see whether intake / OCR / sealing /
 * listings are stuck before real borrowers come through.
 *
 * Access: admin layout already requires super_admin. We do NOT add a
 * second gate here — single source of truth is the layout.
 *
 * Errors: surfaced inline, not swallowed.
 */

type CountRow = { label: string; value: number; error?: string };

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
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const counts: CountRow[] = [];

  counts.push({
    label: "Borrower sessions last 24h",
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
    <main className="px-8 py-10 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Brokerage operations</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Counts only. Use these to spot stuck pipelines before borrowers
          notice.
        </p>
      </header>

      {tenantError && (
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4 mb-6">
          Brokerage tenant unavailable: <code>{tenantError}</code>
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {counts.map((c) => (
          <div
            key={c.label}
            className="rounded-md border border-neutral-800 bg-neutral-900 p-4"
          >
            <div className="text-xs uppercase tracking-wide text-neutral-400">
              {c.label}
            </div>
            {c.error ? (
              <div className="mt-2 text-xs text-red-400 break-all">
                error: {c.error}
              </div>
            ) : (
              <div className="text-3xl font-semibold mt-2">{c.value}</div>
            )}
          </div>
        ))}
      </section>

      <p className="text-xs text-neutral-500 mt-8">
        Tenant: <code>{brokerageBankId ?? "(unresolved)"}</code>
      </p>
    </main>
  );
}
