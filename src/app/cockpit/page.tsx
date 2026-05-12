import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const dynamic = "force-dynamic";

type Counts = {
  draftDeals: number;
  claimedDeals: number;
  sealedDeals: number;
  listingsPreviewing: number;
  listingsClaiming: number;
  listingsPicked: number;
  activeClaims: number;
};

async function fetchCounts(brokerageBankId: string): Promise<Counts> {
  const sb = supabaseAdmin();
  const countQuery = (table: string, filter: Record<string, unknown>) =>
    sb
      .from(table)
      .select("id", { count: "exact", head: true })
      .match(filter);

  const [
    drafts,
    claimed,
    sealed,
    previewing,
    claiming,
    picked,
    activeClaims,
  ] = await Promise.all([
    countQuery("deals", { bank_id: brokerageBankId, origin: "brokerage_anonymous" }),
    countQuery("deals", { bank_id: brokerageBankId, origin: "brokerage_claimed" }),
    sb
      .from("buddy_sealed_packages")
      .select("id", { count: "exact", head: true })
      .is("unsealed_at", null),
    countQuery("marketplace_listings", { status: "previewing" }),
    countQuery("marketplace_listings", { status: "claiming" }),
    countQuery("marketplace_listings", { status: "picked" }),
    countQuery("marketplace_lender_claims", { status: "claimed" }),
  ]);

  return {
    draftDeals: drafts.count ?? 0,
    claimedDeals: claimed.count ?? 0,
    sealedDeals: sealed.count ?? 0,
    listingsPreviewing: previewing.count ?? 0,
    listingsClaiming: claiming.count ?? 0,
    listingsPicked: picked.count ?? 0,
    activeClaims: activeClaims.count ?? 0,
  };
}

export default async function CockpitPage() {
  const brokerageBankId = await getBrokerageBankId();
  const counts = await fetchCounts(brokerageBankId);

  const tiles: Array<{ label: string; value: number; href?: string }> = [
    { label: "Draft deals (pre-email)", value: counts.draftDeals },
    { label: "Claimed deals", value: counts.claimedDeals },
    { label: "Sealed packages", value: counts.sealedDeals },
    {
      label: "Listings — previewing",
      value: counts.listingsPreviewing,
      href: "/admin/brokerage/listings?status=previewing",
    },
    {
      label: "Listings — claiming",
      value: counts.listingsClaiming,
      href: "/admin/brokerage/listings?status=claiming",
    },
    {
      label: "Listings — picked",
      value: counts.listingsPicked,
      href: "/admin/brokerage/listings?status=picked",
    },
    { label: "Active lender claims", value: counts.activeClaims },
  ];

  return (
    <main className="px-8 py-10 max-w-6xl mx-auto">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Buddy Cockpit</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Brokerage operations: pipeline, listings, claims.
          </p>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/brokerage/listings" className="underline">
            Listings
          </Link>
          <Link href="/admin/brokerage/lenders" className="underline">
            Lenders
          </Link>
        </nav>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map((t) => {
          const inner = (
            <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors">
              <div className="text-xs uppercase tracking-wide text-neutral-400">
                {t.label}
              </div>
              <div className="text-3xl font-semibold mt-2">{t.value}</div>
            </div>
          );
          return t.href ? (
            <Link key={t.label} href={t.href}>
              {inner}
            </Link>
          ) : (
            <div key={t.label}>{inner}</div>
          );
        })}
      </section>

      <p className="text-xs text-neutral-500 mt-10">
        Brokerage tenant id: <code>{brokerageBankId}</code>
      </p>
    </main>
  );
}
