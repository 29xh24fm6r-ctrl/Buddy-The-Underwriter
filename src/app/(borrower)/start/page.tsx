import { StartConciergeClient } from "./StartConciergeClient";
import { BorrowerTrustFooter } from "@/components/borrower/BorrowerTrustFooter";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { TestApplicationBanner } from "@/components/qa/TestApplicationBanner";
import { isQABorrowerEmail } from "@/lib/qaIdentity/config";
import { resolveAuthorizedDealState } from "@/lib/qaIdentity/authorization";

import { cache } from "react";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Get your SBA loan - Buddy",
  description:
    "Buddy prepares your complete institutional-grade SBA loan package. Up to 3 matched lenders claim your deal. You pick. Fully neutral - we're paid the same no matter which lender wins.",
};

type StartPathParam = "franchise" | "standard" | undefined;

function normalizePath(value: string | string[] | undefined): StartPathParam {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "franchise" || v === "standard" ? v : undefined;
}

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const path = normalizePath(params.path);

  const session = await getBorrowerSession();

  // Single cached deal lookup — reused between QA session detection and banner
  const loadDeal = cache(async (id: string) => {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("deals")
      .select("is_test, borrower_name, test_run_id")
      .eq("id", id)
      .maybeSingle();
    return (data as any) ?? null;
  });

  // ── P0 SECURITY: Authorize session before passing to client ──
  const sessionEmail = session?.claimed_email?.toLowerCase().trim();
  const isQA = Boolean(sessionEmail && isQABorrowerEmail(sessionEmail));

  const authResult = await resolveAuthorizedDealState({
    dealId: session?.deal_id ?? null,
    isQA,
  });

  // P0 SECURITY: QA identity must never inherit a non-test production deal.
  // initialSession is null for confirmed_non_test, no_selected_deal, and
  // classification_failure — forcing BorrowerWorkspaceGate + QA chooser.
  const isQABlocked = isQA && authResult.authorizedDealId === null;
  const initialSession = session && !isQABlocked
    ? { dealId: session.deal_id, name: await resolveBorrowerName(session.deal_id) }
    : null;

  // P0-7: Banner — reuse the same cached lookup
  const dealLookup = session?.deal_id ? await loadDeal(session.deal_id).catch(() => null) : null;

  return (
    <main className="min-h-screen bg-[#f6f8fb]">
      {/* P0-7: Test application banner for /start borrower shell */}
      {dealLookup?.is_test === true && (
        <TestApplicationBanner isTest={true} />
      )}

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="mb-5 text-2xl font-semibold text-slate-900">Build your SBA loan package</h1>
        <StartConciergeClient
          initialPath={path}
          initialSession={initialSession}
          qaAuthState={isQA ? authResult.state : null}
          qaAuthName={authResult.name}
          qaIsTest={authResult.isTest}
          qaDealId={authResult.dealId}
        />
        <div className="mt-6"><BorrowerTrustFooter /></div>
      </div>
    </main>
  );
}

async function resolveBorrowerName(dealId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("deals")
    .select("borrower_name")
    .eq("id", dealId)
    .maybeSingle();
  const name = data?.borrower_name;
  return typeof name === "string" && name.trim() ? name.trim().split(" ")[0] : null;
}
