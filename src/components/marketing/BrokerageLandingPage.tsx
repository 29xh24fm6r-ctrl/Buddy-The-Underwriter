import Link from "next/link";
import { buddyHeroImage } from "@/components/marketing/heroImage";
import {
  brokerageLandingFontVariables,
  poppins,
} from "@/components/marketing/brokerageFonts";

const STEPS = [
  { n: 1, title: "Tell Buddy about your business", desc: "Answer questions about your business, financials, and loan needs. Buddy's AI concierge guides you." },
  { n: 2, title: "Upload your documents", desc: "Tax returns, financials, and supporting docs. Buddy extracts and organizes everything." },
  { n: 3, title: "Buddy builds your package", desc: "Business plan, projections, feasibility study, SBA forms — prepared and reviewed for completeness." },
  { n: 4, title: "Lenders review and compete", desc: "Qualified SBA lenders see your anonymized profile and submit claims through the marketplace." },
  { n: 5, title: "You choose your lender", desc: "Compare offers and pick the lender that fits. Your identity stays private until you decide." },
  { n: 6, title: "Buddy coordinates closing", desc: "Conditions tracking, document collection, and funding verification — all the way to funded." },
];

const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#fees", label: "Fees" },
  { href: "#banks", label: "For lenders" },
];

function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <div
      className={`${poppins.className} flex items-center justify-center rounded-[9px] bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] font-extrabold italic text-white`}
      style={{ width: size, height: size, fontSize: size * 0.56 }}
    >
      B
    </div>
  );
}

export function BrokerageLandingPage() {
  return (
    <main
      className={`${brokerageLandingFontVariables} min-h-screen bg-[#f6f8fb] font-[family-name:var(--font-brokerage-body)] text-[#12263f] antialiased`}
    >
      {/* Nav */}
      <nav className="sticky top-0 z-50 flex items-center justify-between border-b border-[#12263f]/[0.07] bg-[#f6f8fb]/85 px-5 py-3.5 backdrop-blur-md sm:px-10">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <div className="leading-none">
            <div className={`${poppins.className} text-lg font-bold text-[#12263f]`}>
              Buddy
            </div>
            <div className="mt-0.5 text-[8px] font-semibold tracking-[2px] text-[#6b8299]">
              THE SBA UNDERWRITER
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-7">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="hidden text-[15px] font-semibold text-[#3d5674] transition hover:text-[#1c8de0] sm:inline"
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/apply"
            className="inline-block rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-[22px] py-[11px] text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(28,141,224,0.28)] transition hover:brightness-[1.06]"
          >
            Start your package
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0e2340] via-[#12263f] to-[#173250] px-5 py-16 text-white sm:px-10 sm:py-24">
        <div className="pointer-events-none absolute -right-20 -top-32 h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,rgba(28,141,224,0.28),transparent_70%)]" />
        <div className="relative mx-auto grid max-w-[1240px] items-center gap-10 sm:gap-14 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#4db8f0]/35 bg-[#1c8de0]/[0.16] px-[15px] py-[7px] text-[13px] font-semibold tracking-[0.3px] text-[#8fd0f7]">
              <span className="h-[7px] w-[7px] rounded-full bg-[#4db8f0]" />
              The world&apos;s first Loan Operations System
            </div>
            <h1
              className={`${poppins.className} mt-[22px] text-[34px] font-extrabold leading-[1.08] tracking-[-1px] sm:text-[52px]`}
            >
              Your SBA loan package, built and matched to the right lender.
            </h1>
            <p className="mb-8 mt-5 max-w-[520px] text-[17px] leading-relaxed text-[#b9cbdd] sm:text-[19px]">
              Buddy prepares your complete SBA application, scores your deal,
              and connects you with qualified lenders through a competitive
              marketplace. You pick the lender — we coordinate closing.
            </p>
            <div className="flex flex-wrap gap-3.5">
              <Link
                href="/apply"
                className="inline-block rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-7 py-[15px] text-base font-bold text-white shadow-[0_10px_28px_rgba(28,141,224,0.4)] transition hover:brightness-[1.06]"
              >
                Start your SBA package
              </Link>
              <Link
                href="/start"
                className="inline-block rounded-xl border border-white/[0.18] bg-white/[0.08] px-7 py-[15px] text-base font-bold text-white transition hover:bg-white/[0.14]"
              >
                Talk to Buddy
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-6 sm:gap-[30px]">
              <div>
                <div className={`${poppins.className} text-2xl font-bold text-[#4db8f0] sm:text-[26px]`}>
                  92%
                </div>
                <div className="mt-0.5 text-[13px] text-[#8ba1b8]">Avg. confidence score</div>
              </div>
              <div className="hidden w-px bg-white/10 sm:block" />
              <div>
                <div className={`${poppins.className} text-2xl font-bold text-[#4db8f0] sm:text-[26px]`}>
                  End-to-end
                </div>
                <div className="mt-0.5 text-[13px] text-[#8ba1b8]">Intake to funded</div>
              </div>
              <div className="hidden w-px bg-white/10 sm:block" />
              <div>
                <div className={`${poppins.className} text-2xl font-bold text-[#4db8f0] sm:text-[26px]`}>
                  SBA 7(a)
                </div>
                <div className="mt-0.5 text-[13px] text-[#8ba1b8]">&amp; 504 ready</div>
              </div>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-3.5 rounded-3xl bg-gradient-to-br from-[#1c8de0]/35 to-transparent" />
            <img
              src={buddyHeroImage}
              alt="Buddy the SBA Underwriter with loan underwriting dashboard"
              className="relative block w-full rounded-2xl shadow-[0_30px_70px_rgba(0,0,0,0.5)]"
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-[1240px] px-5 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto mb-14 max-w-[640px] text-center">
          <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
            How it works
          </div>
          <h2 className={`${poppins.className} mb-3 mt-3.5 text-[28px] font-bold tracking-[-0.5px] sm:text-[38px]`}>
            From application to funded, guided the whole way
          </h2>
          <p className="text-base leading-relaxed text-[#5b7189] sm:text-[17px]">
            Buddy&apos;s AI concierge walks you through every step. Your identity
            stays private until you choose a lender.
          </p>
        </div>
        <div className="grid gap-[22px] sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-[#12263f]/[0.07] bg-white p-7 shadow-[0_2px_14px_rgba(18,38,63,0.04)] transition hover:-translate-y-[3px] hover:shadow-[0_12px_30px_rgba(18,38,63,0.1)]"
            >
              <div
                className={`${poppins.className} mb-[18px] flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#0e2340] to-[#1c8de0] text-[19px] font-bold text-white`}
              >
                {s.n}
              </div>
              <h3 className="mb-2 text-[19px] font-semibold">{s.title}</h3>
              <p className="text-[15px] leading-relaxed text-[#5b7189]">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* For banks */}
      <section
        id="banks"
        data-section="bank-platform-entry"
        className="mx-auto max-w-[1240px] px-5 py-16 sm:px-10 sm:py-24"
      >
        <div className="relative flex flex-wrap items-center justify-between gap-10 overflow-hidden rounded-[22px] bg-gradient-to-br from-[#0e2340] to-[#173250] px-7 py-11 text-white sm:px-14 sm:py-[52px]">
          <div className="pointer-events-none absolute -bottom-20 right-16 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(28,141,224,0.25),transparent_70%)]" />
          <div className="relative max-w-[560px]">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#8fd0f7]">
              For banks &amp; SBA lenders
            </div>
            <h2 className={`${poppins.className} my-3 text-2xl font-bold tracking-[-0.5px] sm:text-[30px]`}>
              Looking for Buddy The Underwriter?
            </h2>
            <p className="text-base leading-relaxed text-[#b9cbdd]">
              Our bank-facing underwriting intelligence platform — guided
              intake, underwriting automation, and examiner-safe audit
              trails.
            </p>
          </div>
          <Link
            href="/underwriter"
            className="relative whitespace-nowrap rounded-xl bg-white px-7 py-[15px] text-base font-bold text-[#12263f] transition hover:brightness-95"
          >
            Explore the banking platform →
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section id="start" className="mx-auto max-w-[1240px] px-5 pb-20 pt-6 text-center sm:px-10">
        <h2 className={`${poppins.className} text-[32px] font-extrabold tracking-[-0.8px] sm:text-[42px]`}>
          Ready to get started?
        </h2>
        <p className="mx-auto mb-8 mt-4 max-w-[560px] text-lg leading-relaxed text-[#5b7189]">
          Buddy builds your complete SBA package and matches you with the
          right lender. Start in minutes.
        </p>
        <Link
          href="/apply"
          className="inline-block rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-10 py-[17px] text-[17px] font-bold text-white shadow-[0_12px_32px_rgba(28,141,224,0.35)] transition hover:brightness-[1.06]"
        >
          Start your SBA package
        </Link>
      </section>

      {/* Fee disclosure */}
      <section id="fees" className="mx-auto max-w-[900px] px-5 pb-14 sm:px-10">
        <div className="border-t border-[#12263f]/[0.09] pt-[22px]">
          <div className="mb-2 flex items-center gap-2.5">
            <span className={`${poppins.className} text-[13px] font-bold uppercase tracking-[0.5px] text-[#3d5674]`}>
              Fee disclosure
            </span>
            <span className="text-xs font-bold text-[#16a34a]">$1,000 packaging fee</span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-[#6b8299]">
            A packaging fee of $1,000 applies for SBA loan preparation and
            lender matching services. This fee may be financed into the loan
            at closing, subject to lender approval. Buddy may also receive a
            referral fee from the selected lender, disclosed on SBA Form
            159. Buddy does not guarantee loan approval — SBA loan approval
            is subject to lender underwriting, SBA guidelines, and borrower
            eligibility.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0e2340] px-5 py-9 text-[#8ba1b8] sm:px-10">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-[11px]">
            <LogoMark size={30} />
            <div className={`${poppins.className} text-[17px] font-bold text-white`}>Buddy</div>
          </div>
          <div className="text-[13px]">
            Smarter Analysis. Stronger Approvals. &nbsp;·&nbsp; © 2026 Buddy
          </div>
        </div>
      </footer>
    </main>
  );
}
