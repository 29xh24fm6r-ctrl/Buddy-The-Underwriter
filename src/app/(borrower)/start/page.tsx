import { StartConciergeClient } from "./StartConciergeClient";
import { BorrowerTrustFooter } from "@/components/borrower/BorrowerTrustFooter";

export const metadata = {
  title: "Get your SBA loan - Buddy",
  description:
    "Buddy prepares your complete institutional-grade SBA loan package. Up to 3 matched lenders claim your deal. You pick. Fully neutral - we're paid the same no matter which lender wins.",
};

export default function StartPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.14),_transparent_28%),linear-gradient(180deg,_#fffdf8_0%,_#fffaf0_42%,_#f8fafc_100%)]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <section className="rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_22px_70px_rgba(120,53,15,0.10)] backdrop-blur sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div>
              <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-900">
                Buddy SBA concierge
              </div>
              <h1 className="mt-4 font-serif text-4xl leading-tight text-stone-950 sm:text-5xl">
                Build your SBA package with guidance, not guesswork.
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-stone-700 sm:text-lg">
                Buddy turns a scattered borrower checklist into a guided SBA
                package. Start with chat or voice, let Buddy organize what
                matters, and keep full lender neutrality from start to finish.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Guided start
                  </div>
                  <p className="mt-2 text-sm text-stone-700">
                    Tell Buddy what you are financing and get a structured next step.
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Neutral matching
                  </div>
                  <p className="mt-2 text-sm text-stone-700">
                    Up to three lenders can review your package and you choose who wins.
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Secure return
                  </div>
                  <p className="mt-2 text-sm text-stone-700">
                    Your progress stays in this browser so you can come back without starting over.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-stone-200 bg-[linear-gradient(180deg,_#fffaf0_0%,_#ffffff_100%)] p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                What to expect
              </div>
              <ol className="mt-4 space-y-4">
                <li>
                  <div className="text-sm font-semibold text-stone-950">1. Tell Buddy about the deal</div>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    Share what you are buying, refinancing, or expanding.
                  </p>
                </li>
                <li>
                  <div className="text-sm font-semibold text-stone-950">2. Build the borrower package</div>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    Buddy organizes your application, documents, and SBA-ready narrative.
                  </p>
                </li>
                <li>
                  <div className="text-sm font-semibold text-stone-950">3. Move into lender review</div>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    Once your package is ready, matched lenders can compete for the deal.
                  </p>
                </li>
              </ol>
            </div>
          </div>

          <div className="mt-8">
            <StartConciergeClient />
          </div>
        </section>

        <div className="mt-6">
          <BorrowerTrustFooter />
        </div>
      </div>
    </main>
  );
}
