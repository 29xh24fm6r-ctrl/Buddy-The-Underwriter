"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Poppins, Plus_Jakarta_Sans } from "next/font/google";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const SCORE_FACTORS = [
  {
    label: "SBA certification status",
    weight: "35%",
    desc: "Whether your brand carries an active SBA franchise certification and, if so, what addendum requirements apply.",
  },
  {
    label: "FDD Item 19 tier",
    weight: "30%",
    desc: "Where the brand's disclosed financial performance representations rank against comparable franchise systems.",
  },
  {
    label: "Brand maturity",
    weight: "20%",
    desc: "Unit count and system scale — an early-stage concept scores differently than an established, multi-hundred-unit brand.",
  },
  {
    label: "Franchisor support",
    weight: "15%",
    desc: "Signals drawn from Item 19 disclosure, SBA eligibility, and system size that indicate franchisor backing strength.",
  },
];

const WHY_BUDDY = [
  {
    title: "You're not starting from zero",
    desc: "Most SBA lenders are meeting your franchise brand for the first time. Buddy already has its certification status, Item 19 data, and royalty structure loaded in — so underwriting starts with answers, not research.",
  },
  {
    title: "No separate franchise-broker fee",
    desc: "Franchise SBA deals often get routed through a specialized franchise-finance consultant on top of the lender. Buddy folds that expertise into the same package, at the same cost, with nobody extra to pay.",
  },
  {
    title: "Matched to lenders who know your brand",
    desc: "The marketplace can surface lenders with real experience financing your specific franchise system — not just general SBA capacity.",
  },
];

interface BrandResult {
  id: string;
  brand_name: string;
  franchisor_legal_name: string | null;
  sba_eligible: boolean | null;
  sba_certification_status: string | null;
  franchise_fee_min: number | null;
  franchise_fee_max: number | null;
  initial_investment_min: number | null;
  initial_investment_max: number | null;
  royalty_pct: number | null;
  has_item_19: boolean | null;
}

function money(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return `$${Math.round(n).toLocaleString()}`;
}

function range(min: number | null | undefined, max: number | null | undefined): string {
  const lo = money(min);
  const hi = money(max);
  if (lo && hi) return `${lo} – ${hi}`;
  if (lo) return `From ${lo}`;
  if (hi) return `Up to ${hi}`;
  return "—";
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "Status unknown";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Live brand-power search — the hero's proof moment. A borrower types a
// franchise brand and immediately sees the real SBA data Buddy already has
// on it, pulled from the same /api/franchise/search endpoint the borrower
// flow uses, before they've clicked anything else on the site.
function BrandPowerSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrandResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<BrandResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/franchise/search?q=${encodeURIComponent(query.trim())}&limit=5`,
        );
        const json = await res.json();
        setResults((json.brands as BrandResult[] | undefined) ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
        setSearched(true);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  if (selected) {
    const eligible = selected.sba_eligible === true;
    return (
      <div className="mx-auto max-w-[560px] rounded-[20px] bg-white p-6 text-left text-[#12263f] shadow-[0_20px_50px_rgba(0,0,0,0.35)] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div
              className="text-[19px] font-bold"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              {selected.brand_name}
            </div>
            {selected.franchisor_legal_name && (
              <div className="mt-0.5 text-[13px] text-[#5b7189]">
                {selected.franchisor_legal_name}
              </div>
            )}
          </div>
          <span
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-bold ${
              eligible
                ? "bg-[#16a34a]/[0.12] text-[#16a34a]"
                : "bg-[#12263f]/[0.06] text-[#5b7189]"
            }`}
          >
            {eligible ? "SBA eligible" : statusLabel(selected.sba_certification_status)}
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[#12263f]/[0.08] pt-5 text-[13.5px]">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#8ba1b8]">
              Total investment
            </div>
            <div className="mt-0.5 font-semibold">
              {range(selected.initial_investment_min, selected.initial_investment_max)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#8ba1b8]">
              Franchise fee
            </div>
            <div className="mt-0.5 font-semibold">
              {range(selected.franchise_fee_min, selected.franchise_fee_max)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#8ba1b8]">
              Royalty
            </div>
            <div className="mt-0.5 font-semibold">
              {selected.royalty_pct !== null && selected.royalty_pct !== undefined
                ? `${selected.royalty_pct}%`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#8ba1b8]">
              Item 19 data
            </div>
            <div className="mt-0.5 font-semibold">
              {selected.has_item_19 ? "Available" : "Not disclosed"}
            </div>
          </div>
        </div>
        <Link
          href="/start?path=franchise"
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-6 py-[13px] text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(28,141,224,0.3)] transition hover:brightness-[1.06]"
        >
          Start my {selected.brand_name} package →
        </Link>
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setQuery("");
          }}
          className="mt-3 w-full text-center text-[13.5px] font-semibold text-[#5b7189] hover:text-[#1c8de0]"
        >
          Search a different brand
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[#8ba1b8]"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => {
            setSelected(null);
            setQuery(e.target.value);
          }}
          placeholder="Type your franchise brand — e.g. Chick-fil-A, Anytime Fitness..."
          className="w-full rounded-2xl bg-white py-[17px] pl-[52px] pr-5 text-[15.5px] text-[#12263f] placeholder:text-[#8ba1b8] shadow-[0_16px_40px_rgba(0,0,0,0.3)] outline-none ring-2 ring-transparent focus:ring-[#4db8f0]"
        />
      </div>
      {(searching || results.length > 0 || (searched && results.length === 0)) && (
        <div className="mt-3 overflow-hidden rounded-2xl bg-white text-left shadow-[0_16px_40px_rgba(0,0,0,0.3)]">
          {searching && (
            <div className="px-5 py-4 text-[14px] text-[#5b7189]">
              Searching 8,400+ franchise brands…
            </div>
          )}
          {!searching &&
            results.map((brand) => (
              <button
                key={brand.id}
                type="button"
                onClick={() => setSelected(brand)}
                className="flex w-full items-center justify-between gap-3 border-b border-[#12263f]/[0.06] px-5 py-3.5 text-left last:border-0 hover:bg-[#f6f8fb]"
              >
                <span className="text-[14.5px] font-semibold text-[#12263f]">
                  {brand.brand_name}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                    brand.sba_eligible
                      ? "bg-[#16a34a]/[0.12] text-[#16a34a]"
                      : "bg-[#12263f]/[0.06] text-[#5b7189]"
                  }`}
                >
                  {brand.sba_eligible ? "SBA eligible" : "Unverified"}
                </span>
              </button>
            ))}
          {!searching && searched && results.length === 0 && (
            <div className="px-5 py-4 text-[13.5px] leading-relaxed text-[#5b7189]">
              Don&apos;t have that brand yet — Buddy will still build your
              full SBA package, it just starts without a pre-filled brand
              profile.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FranchiseLandingPage() {
  return (
    <main
      className={`${poppins.variable} ${jakarta.variable} min-h-screen bg-[#f6f8fb] text-[#12263f] antialiased`}
      style={{ fontFamily: "var(--font-jakarta), sans-serif" }}
    >
      {/* NAV */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 sm:px-10 backdrop-blur-xl bg-[#f6f8fb]/85 border-b border-[#12263f]/[0.07]">
        <Link href="/" className="flex items-center gap-3">
          <div
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] text-[19px] font-extrabold italic text-white"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            B
          </div>
          <div className="leading-none">
            <div
              className="text-[20px] font-bold text-[#12263f]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Buddy
            </div>
            <div className="mt-0.5 text-[8px] font-semibold tracking-[2px] text-[#6b8299]">
              THE SBA UNDERWRITER
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-4 sm:gap-[30px]">
          <Link
            href="/"
            className="hidden text-[15px] font-semibold text-[#3d5674] hover:text-[#1c8de0] sm:inline"
          >
            Home
          </Link>
          <Link
            href="/apply?path=franchise"
            className="rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-[22px] py-[11px] text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(28,141,224,0.28)] transition hover:brightness-[1.06]"
          >
            Start your package
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative overflow-hidden bg-[linear-gradient(160deg,#0e2340_0%,#12263f_55%,#173250_100%)] px-6 py-16 text-white sm:px-10 sm:py-[76px]">
        <div
          className="pointer-events-none absolute -right-20 -top-[120px] h-[460px] w-[460px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(28,141,224,0.28), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-[840px] text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#4db8f0]/35 bg-[#1c8de0]/[0.16] px-[15px] py-[7px] text-[13px] font-semibold tracking-[0.3px] text-[#8fd0f7]">
            <span className="h-[7px] w-[7px] rounded-full bg-[#4db8f0]" />
            Franchise Financing
          </div>
          <h1
            className="mt-[22px] text-[32px] font-extrabold leading-[1.1] tracking-tight sm:text-[46px]"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            SBA financing that already knows your franchise.
          </h1>
          <p className="mx-auto mb-9 mt-5 max-w-[600px] text-[17px] leading-relaxed text-[#b9cbdd] sm:text-[19px]">
            It's the same SBA 7(a) or 504 loan every borrower gets — Buddy
            just already knows your brand. We track SBA eligibility,
            certification status, and FDD Item 19 financial performance data
            across thousands of franchise brands, and build it directly into
            your SBA Score from question one.
          </p>

          <BrandPowerSearch />

          <p className="mt-6 text-[13.5px] text-[#8ba1b8]">
            Or skip straight in —{" "}
            <Link
              href="/apply?path=franchise"
              className="font-semibold text-white underline decoration-[#4db8f0]/50 underline-offset-4 hover:decoration-[#4db8f0]"
            >
              start your franchise package
            </Link>{" "}
            /{" "}
            <Link
              href="/start?path=franchise"
              className="font-semibold text-white underline decoration-[#4db8f0]/50 underline-offset-4 hover:decoration-[#4db8f0]"
            >
              talk to Buddy
            </Link>
          </p>
          <div className="mt-[46px] flex flex-wrap items-center justify-center gap-x-[38px] gap-y-4">
            <div>
              <div
                className="text-[28px] font-bold text-[#4db8f0]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                8,400+
              </div>
              <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                Franchise brands tracked
              </div>
            </div>
            <div className="hidden h-10 w-px bg-white/[0.12] sm:block" />
            <div>
              <div
                className="text-[28px] font-bold text-[#4db8f0]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                1,476
              </div>
              <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                SBA-certified brands
              </div>
            </div>
            <div className="hidden h-10 w-px bg-white/[0.12] sm:block" />
            <div>
              <div
                className="text-[28px] font-bold text-[#4db8f0]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                853
              </div>
              <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                Brands with Item 19 data
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FRANCHISE QUALITY SCORE */}
      <section className="mx-auto max-w-[1100px] px-6 py-14 sm:px-10 sm:py-[90px]">
        <div className="mx-auto mb-12 max-w-[680px] text-center sm:mb-14">
          <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
            Built into your SBA Score
          </div>
          <h2
            className="mb-3 mt-3.5 text-[26px] font-bold tracking-tight sm:text-[34px]"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            Your Franchise Quality Score
          </h2>
          <p className="text-[16px] leading-relaxed text-[#5b7189]">
            Once you tell Buddy your brand, this component runs automatically
            as part of your overall SBA Score — no separate report, no extra
            step.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {SCORE_FACTORS.map((f) => (
            <div
              key={f.label}
              className="rounded-2xl border border-[#12263f]/[0.07] bg-white p-6 shadow-[0_2px_14px_rgba(18,38,63,0.04)]"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[17px] font-semibold">{f.label}</h3>
                <span className="rounded-full bg-[#1c8de0]/[0.1] px-2.5 py-1 text-[12px] font-bold text-[#1c8de0]">
                  {f.weight}
                </span>
              </div>
              <p className="text-[14.5px] leading-relaxed text-[#5b7189]">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* WHY BUDDY — makes the case on specificity (brand data, matched
          lenders, no extra fee), not by putting down the standard SBA
          7(a)/504 path, which is the exact same loan program. */}
      <section className="mx-auto max-w-[1100px] px-6 pb-14 sm:px-10 sm:pb-[90px]">
        <div className="mx-auto mb-12 max-w-[680px] text-center sm:mb-14">
          <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
            Why franchise buyers choose Buddy
          </div>
          <h2
            className="mb-3 mt-3.5 text-[26px] font-bold tracking-tight sm:text-[34px]"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            Same SBA program. Extra intelligence built in.
          </h2>
          <p className="text-[16px] leading-relaxed text-[#5b7189]">
            You'll still go through the same SBA 7(a) or 504 process as any
            borrower, with the same lenders and the same government-backed
            terms. Buying into a known brand just means Buddy can bring more
            to the table on day one.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {WHY_BUDDY.map((w) => (
            <div
              key={w.title}
              className="rounded-2xl border border-[#12263f]/[0.07] bg-white p-6 shadow-[0_2px_14px_rgba(18,38,63,0.04)]"
            >
              <h3 className="mb-2 text-[17px] font-semibold">{w.title}</h3>
              <p className="text-[14.5px] leading-relaxed text-[#5b7189]">
                {w.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-[1240px] px-6 pb-16 pt-2 text-center sm:px-10 sm:pb-[100px]">
        <h2
          className="text-[30px] font-extrabold tracking-tight sm:text-[38px]"
          style={{ fontFamily: "var(--font-poppins), sans-serif" }}
        >
          Ready to finance your franchise?
        </h2>
        <p className="mx-auto my-4 max-w-[560px] text-[17px] leading-relaxed text-[#5b7189]">
          Start your SBA package and Buddy pulls your brand's SBA data in
          automatically — no separate franchise research required.
        </p>
        <Link
          href="/apply?path=franchise"
          className="inline-flex rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-10 py-[17px] text-[17px] font-bold text-white shadow-[0_12px_32px_rgba(28,141,224,0.35)] transition hover:brightness-[1.06]"
        >
          Start your franchise package
        </Link>
        <p className="mt-5 text-[14px] text-[#5b7189]">
          Not buying into a franchise?{" "}
          <Link
            href="/start?path=standard"
            className="font-semibold text-[#1c8de0] hover:underline"
          >
            Standard SBA 7(a) &amp; 504 financing →
          </Link>
        </p>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#0e2340] px-6 py-[38px] text-[#8ba1b8] sm:px-10">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-[11px]">
            <div
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] text-[16px] font-extrabold italic text-white"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              B
            </div>
            <div
              className="text-[17px] font-bold text-white"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Buddy
            </div>
          </div>
          <div className="text-[13px]">
            Smarter Analysis. Stronger Approvals. &nbsp;·&nbsp; © 2026 Buddy
          </div>
        </div>
      </footer>
    </main>
  );
}
