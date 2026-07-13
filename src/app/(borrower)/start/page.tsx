import { StartConciergeClient } from "./StartConciergeClient";
import { BorrowerTrustFooter } from "@/components/borrower/BorrowerTrustFooter";

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
  const isFranchisePath = path === "franchise";

  return (
    <main className="min-h-screen bg-[#f6f8fb]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <section className="brand-hero-bg relative overflow-hidden rounded-[2rem] p-6 shadow-[0_24px_70px_rgba(14,35,64,0.35)] sm:p-8 lg:p-10">
          <div
            className="brand-glow pointer-events-none absolute -right-24 -top-32 h-[460px] w-[460px] rounded-full"
            aria-hidden="true"
          />

          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-brand-blue-400">
                <span className="h-[7px] w-[7px] rounded-full bg-[#4db8f0]" />
                {isFranchisePath ? "Buddy franchise financing" : "Buddy SBA concierge"}
              </div>
              <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
                {isFranchisePath
                  ? "Build your franchise SBA package, matched to your brand."
                  : "Build your SBA package with guidance, not guesswork."}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-white/70 sm:text-lg">
                {isFranchisePath
                  ? "Tell Buddy your franchise brand and it already knows the SBA certification status, FDD data, and financing requirements — no guesswork on eligibility."
                  : "Buddy turns a scattered borrower checklist into a guided SBA package. Start with chat or voice, let Buddy organize what matters, and keep full lender neutrality from start to finish."}
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue-400">
                    Guided start
                  </div>
                  <p className="mt-2 text-sm text-white/70">
                    Tell Buddy what you are financing and get a structured next step.
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue-400">
                    Neutral matching
                  </div>
                  <p className="mt-2 text-sm text-white/70">
                    Up to three lenders can review your package and you choose who wins.
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue-400">
                    Secure return
                  </div>
                  <p className="mt-2 text-sm text-white/70">
                    Your progress stays in this browser so you can come back without starting over.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue-400">
                What to expect
              </div>
              <ol className="mt-4 space-y-4">
                <li className="flex gap-3">
                  <span className="brand-gradient-cta flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                    1
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-white">Tell Buddy about the deal</div>
                    <p className="mt-1 text-sm leading-6 text-white/60">
                      Share what you are buying, refinancing, or expanding.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="brand-gradient-cta flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                    2
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-white">Build the borrower package</div>
                    <p className="mt-1 text-sm leading-6 text-white/60">
                      Buddy organizes your application, documents, and SBA-ready narrative.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="brand-gradient-cta flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                    3
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-white">Move into lender review</div>
                    <p className="mt-1 text-sm leading-6 text-white/60">
                      Once your package is ready, matched lenders can compete for the deal.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          </div>

          <div className="relative mt-8 rounded-[1.75rem] bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.25)] sm:p-6">
            <StartConciergeClient initialPath={path} />
          </div>
        </section>

        <div className="mt-6">
          <BorrowerTrustFooter />
        </div>
      </div>
    </main>
  );
}
