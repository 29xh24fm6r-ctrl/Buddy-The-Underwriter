import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Buddy The Underwriter - Public Share Screen";
const FONT_LINKS = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "background-light": "#f6f7f8",
                        "background-dark": "#101822",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"]
                    },
                    boxShadow: {
                        'soft': '0 2px 12px -2px rgba(16, 24, 34, 0.06)',
                    }
                },
            },
        }`;
const STYLES = [
  "body {\n            font-feature-settings: \"cv11\", \"ss01\";\n            -webkit-font-smoothing: antialiased;\n        }"
];
const BODY_HTML = `<!-- Top Navigation Bar -->
<header class="sticky top-0 z-20 w-full bg-white border-b border-[#e5e7eb] px-6 h-16 flex items-center justify-between">
<!-- Brand -->
<div class="flex items-center gap-3 text-[#111418]">
<div class="size-8 flex items-center justify-center bg-primary/10 rounded-lg text-primary">
<span class="material-symbols-outlined" style="font-size: 20px;">history_edu</span>
</div>
<h1 class="text-lg font-bold leading-tight tracking-[-0.015em]">Buddy The Underwriter</h1>
</div>
<!-- Actions -->
<div class="flex items-center gap-4">
<button class="hidden sm:flex h-9 items-center justify-center px-4 rounded-lg border border-transparent text-sm font-semibold text-[#64748b] hover:text-[#111418] hover:bg-gray-50 transition-all">
                Continue
            </button>
<div class="hidden sm:block h-6 w-px bg-[#e5e7eb]"></div>
<button class="flex h-9 items-center justify-center px-5 rounded-lg bg-primary text-white text-sm font-bold shadow-sm hover:bg-primary/90 active:scale-95 transition-all">
                Export
            </button>
</div>
</header>
<!-- Main Content Area -->
<main class="flex-1 flex flex-col items-center py-8 px-4 sm:px-6 lg:px-8">
<!-- Screen Card Wrapper -->
<div class="w-full max-w-[960px] bg-white rounded-xl border border-[#e2e8f0] shadow-soft overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
<!-- Artifact Header -->
<div class="flex flex-wrap items-center justify-between gap-2 px-6 py-3 bg-[#f8fafc] border-b border-[#f1f5f9]">
<div class="flex items-center gap-2 text-[#64748b]">
<span class="material-symbols-outlined text-[18px]">auto_mode</span>
<span class="text-[11px] font-bold tracking-widest uppercase">Commercial Underwriting, Automated.</span>
</div>
<div class="flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-white border border-[#e2e8f0]">
<div class="size-2 rounded-full bg-emerald-500 animate-pulse"></div>
<span class="text-xs font-medium text-[#475569]">Shared screen</span>
</div>
</div>
<!-- Card Content -->
<div class="p-6 md:p-10 flex flex-col gap-10">
<!-- Page Heading -->
<div class="flex flex-col gap-2">
<h2 class="text-[#111418] tracking-tight text-3xl font-bold leading-tight">Underwriting Dashboard</h2>
<p class="text-[#64748b] text-base font-normal leading-normal">Loan status, missing items, and risk flags for <span class="font-medium text-[#111418]">Highland Park Multifamily</span>.</p>
</div>
<!-- Panel 1: Stats Cards (Grid) -->
<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
<!-- DSCR -->
<div class="flex flex-col gap-1 p-5 rounded-lg border border-[#e2e8f0] bg-white hover:border-primary/30 transition-colors group">
<div class="flex items-center gap-2 mb-1">
<span class="material-symbols-outlined text-[#94a3b8] text-[20px] group-hover:text-primary transition-colors">analytics</span>
<span class="text-sm font-medium text-[#64748b]">DSCR</span>
</div>
<p class="text-2xl font-bold text-[#111418] tracking-tight">1.25x</p>
</div>
<!-- LTV -->
<div class="flex flex-col gap-1 p-5 rounded-lg border border-[#e2e8f0] bg-white hover:border-primary/30 transition-colors group">
<div class="flex items-center gap-2 mb-1">
<span class="material-symbols-outlined text-[#94a3b8] text-[20px] group-hover:text-primary transition-colors">pie_chart</span>
<span class="text-sm font-medium text-[#64748b]">LTV</span>
</div>
<p class="text-2xl font-bold text-[#111418] tracking-tight">65%</p>
</div>
<!-- NOI -->
<div class="flex flex-col gap-1 p-5 rounded-lg border border-[#e2e8f0] bg-white hover:border-primary/30 transition-colors group">
<div class="flex items-center gap-2 mb-1">
<span class="material-symbols-outlined text-[#94a3b8] text-[20px] group-hover:text-primary transition-colors">attach_money</span>
<span class="text-sm font-medium text-[#64748b]">NOI</span>
</div>
<p class="text-2xl font-bold text-[#111418] tracking-tight">$450k</p>
</div>
<!-- Debt Yield -->
<div class="flex flex-col gap-1 p-5 rounded-lg border border-[#e2e8f0] bg-white hover:border-primary/30 transition-colors group">
<div class="flex items-center gap-2 mb-1">
<span class="material-symbols-outlined text-[#94a3b8] text-[20px] group-hover:text-primary transition-colors">percent</span>
<span class="text-sm font-medium text-[#64748b]">Debt Yield</span>
</div>
<p class="text-2xl font-bold text-[#111418] tracking-tight">9.2%</p>
</div>
</div>
<!-- Panels 2 & 3: Content Split -->
<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
<!-- Panel 2: Table (Deal Specs) -->
<div class="lg:col-span-7 flex flex-col gap-5">
<div class="flex items-center justify-between border-b border-[#f1f5f9] pb-3">
<h3 class="text-base font-bold text-[#111418]">Deal Specifications</h3>
<button class="text-primary text-sm font-semibold hover:underline">Edit</button>
</div>
<div class="flex flex-col gap-0">
<!-- Row 1 -->
<div class="flex justify-between items-center py-3 border-b border-dashed border-[#e2e8f0]">
<span class="text-sm text-[#64748b]">Sponsor</span>
<span class="text-sm font-medium text-[#111418] text-right">Acme Capital Partners</span>
</div>
<!-- Row 2 -->
<div class="flex justify-between items-center py-3 border-b border-dashed border-[#e2e8f0]">
<span class="text-sm text-[#64748b]">Property Type</span>
<span class="text-sm font-medium text-[#111418] text-right">Multifamily Class B</span>
</div>
<!-- Row 3 -->
<div class="flex justify-between items-center py-3 border-b border-dashed border-[#e2e8f0]">
<span class="text-sm text-[#64748b]">Loan Amount</span>
<span class="text-sm font-medium text-[#111418] text-right">$12,500,000</span>
</div>
<!-- Row 4 -->
<div class="flex justify-between items-center py-3 border-b border-dashed border-[#e2e8f0]">
<span class="text-sm text-[#64748b]">Maturity</span>
<span class="text-sm font-medium text-[#111418] text-right">5 Years</span>
</div>
<!-- Row 5 -->
<div class="flex justify-between items-center py-3 border-b border-dashed border-[#e2e8f0]">
<span class="text-sm text-[#64748b]">Rate Type</span>
<span class="text-sm font-medium text-[#111418] text-right">Fixed (Swap)</span>
</div>
<!-- Row 6 -->
<div class="flex justify-between items-center py-3 border-b border-dashed border-[#e2e8f0]">
<span class="text-sm text-[#64748b]">Amortization</span>
<span class="text-sm font-medium text-[#111418] text-right">30 Years</span>
</div>
</div>
</div>
<!-- Panel 3: List (Flags & Actions) -->
<div class="lg:col-span-5 flex flex-col gap-5">
<div class="flex items-center justify-between border-b border-[#f1f5f9] pb-3">
<h3 class="text-base font-bold text-[#111418]">Review Items</h3>
<span class="bg-red-50 text-red-700 text-xs font-bold px-2 py-0.5 rounded">3 Active</span>
</div>
<div class="flex flex-col gap-3">
<!-- Flag Item 1 -->
<div class="flex gap-3 p-4 rounded-lg bg-[#fff1f2] border border-[#fecdd3]">
<div class="mt-0.5">
<span class="material-symbols-outlined text-red-500" style="font-size: 20px;">description</span>
</div>
<div class="flex flex-col">
<h4 class="text-sm font-bold text-[#881337]">Missing Document</h4>
<p class="text-xs text-[#9f1239] mt-1 leading-relaxed">Updated Rent Roll (September) is required to finalize sizing.</p>
</div>
</div>
<!-- Flag Item 2 -->
<div class="flex gap-3 p-4 rounded-lg bg-[#fffbeb] border border-[#fde68a]">
<div class="mt-0.5">
<span class="material-symbols-outlined text-amber-500" style="font-size: 20px;">warning</span>
</div>
<div class="flex flex-col">
<h4 class="text-sm font-bold text-[#92400e]">Risk Flag</h4>
<p class="text-xs text-[#9a3412] mt-1 leading-relaxed">Occupancy dipped below 90% in Q2, explanation needed.</p>
</div>
</div>
<!-- Flag Item 3 -->
<div class="flex gap-3 p-4 rounded-lg bg-[#f0f9ff] border border-[#bae6fd]">
<div class="mt-0.5">
<span class="material-symbols-outlined text-sky-500" style="font-size: 20px;">fact_check</span>
</div>
<div class="flex flex-col">
<h4 class="text-sm font-bold text-[#075985]">Condition</h4>
<p class="text-xs text-[#0c4a6e] mt-1 leading-relaxed">Seismic retrofit quote required prior to closing.</p>
</div>
</div>
</div>
</div>
</div>
</div>
</div>
<!-- Minimal Footer -->
<footer class="mt-12 mb-6">
<p class="text-xs font-medium text-[#94a3b8] tracking-wide">Generated with Buddy The Underwriter</p>
</footer>
</main>`;

export default function Page() {
  return (
    <StitchFrame
      title={TITLE}
      fontLinks={FONT_LINKS}
      tailwindCdnSrc={TAILWIND_CDN}
      tailwindConfigJs={TAILWIND_CONFIG_JS}
      styles={STYLES}
      bodyHtml={BODY_HTML}
    />
  );
}
