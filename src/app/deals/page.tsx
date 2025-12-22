// src/app/deals/page.tsx
import { redirect } from "next/navigation";
import { CommandBridgeShell } from "@/components/home/CommandBridgeShell";
import { CommandBridgeV3 } from "@/components/home/CommandBridgeV3";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function DealsHomePage() {
  // Auth is handled by middleware - we can assume user is authenticated here
  // Get active bank
  const pick = await tryGetCurrentBankId();
  
  if (!pick.ok) {
    // If no bank is set, redirect to bank selection
    if (pick.reason === "no_memberships" || pick.reason === "multiple_memberships") {
      redirect("/select-bank");
    }
    
    // For other errors, show error state
    return (
      <CommandBridgeShell>
        <div className="relative flex min-h-[70vh] items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5 px-8 text-center">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-3xl animate-pulse" />
            <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
          </div>

          <div className="relative z-10 max-w-2xl">
            <div className="mb-4 text-xs uppercase tracking-widest text-slate-300">AI Credit Intelligence</div>
            <h1 className="text-4xl font-semibold tracking-tight text-white">Meet Buddy.</h1>
            <p className="mt-3 text-lg text-slate-200">Your underwriting command center.</p>
            <p className="mt-4 text-sm text-slate-300 leading-relaxed">
              Choose your institution so Buddy can tailor evidence, portal, and underwriting workflows to your bank.
            </p>

            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <a
                href="/select-bank"
                className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition"
              >
                Enter Command Bridge →
              </a>

              <a href="/ops" className="text-sm text-slate-300 hover:text-white transition">
                Manage institutions
              </a>
            </div>
          </div>
        </div>
      </CommandBridgeShell>
    );
  }

  // Get bank name
  const sb = supabaseAdmin();
  const { data: bank } = await sb
    .from("banks")
    .select("id, name")
    .eq("id", pick.bankId)
    .maybeSingle();

  const bankName = bank?.name ?? "Your Bank";

  return (
    <CommandBridgeShell>
      <CommandBridgeV3 bankId={pick.bankId} bankName={bankName} />
    </CommandBridgeShell>
  );
}
