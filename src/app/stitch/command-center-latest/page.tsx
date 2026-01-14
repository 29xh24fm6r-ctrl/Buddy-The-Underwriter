import { redirect } from "next/navigation";

const TITLE = "Buddy The Underwriter - Public Share Screen";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#2563eb","background-light": "#f8fafc",
                        "surface": "#ffffff",
                        "border-subtle": "#e2e8f0",
                        "text-main": "#0f172a",
                        "text-muted": "#64748b",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "mono": ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"]
                    },
                    boxShadow: {
                        'command': '0 4px 20px -2px rgba(0, 0, 0, 0.08), 0 1px 4px -1px rgba(0, 0, 0, 0.04)',
                    }
                },
            },
        }`;
const STYLES = [
  "body {\n            font-feature-settings: 'cv11', 'ss01', 'tnum';-webkit-font-smoothing: antialiased;\n        }\n        .command-card-header {\n            background-image: linear-gradient(to bottom, #f8fafc, #ffffff);\n        }",
  '/* Buddy override: expand Stitch "share card" to full-width */\nhtml, body { height: 100%; }\nbody { margin: 0; }\n\n/* export uses: w-full max-w-[1024px] centered card */\ndiv[class*="max-w-[1024px]"] { max-width: 100% !important; width: 100% !important; }\n\n/* soften big outer padding when centered */\nmain.flex.flex-col.items-center.py-8 { padding-left: 16px !important; padding-right: 16px !important; }',
];
const BODY_HTML = `<header class="sticky top-0 z-30 w-full bg-white/90 backdrop-blur-md border-b border-border-subtle h-14 flex items-center justify-between px-6">
<div class="flex items-center gap-3 w-1/4">
<div class="size-6 flex items-center justify-center bg-primary text-white rounded-[4px]">
<span class="material-symbols-outlined" style="font-size: 16px;">history_edu</span>
</div>
<h1 class="text-sm font-bold tracking-tight text-text-main">Buddy The Underwriter</h1>
</div>
<div class="hidden md:flex items-center justify-center w-2/4">
<div class="px-3 py-1 bg-slate-100 border border-slate-200 rounded-md flex items-center gap-2">
<span class="material-symbols-outlined text-slate-400 text-[14px]">share</span>
<span class="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Shared Underwriting Artifact</span>
</div>
</div>
<div class="flex items-center justify-end gap-3 w-1/4">
<button class="h-8 px-3 rounded-md border border-slate-200 text-xs font-semibold text-text-muted hover:text-text-main hover:bg-slate-50 transition-all">
                Continue
            </button>
<button class="h-8 px-3 rounded-md bg-primary text-white text-xs font-semibold shadow-sm hover:bg-primary/90 transition-all flex items-center gap-1.5">
<span>Export</span>
<span class="material-symbols-outlined text-[14px]">download</span>
</button>
</div>
</header>
<main class="flex-1 flex flex-col items-center py-8 px-4 sm:px-6 lg:px-8">
<div class="w-full max-w-[1024px] bg-white rounded-lg border border-border-subtle shadow-command overflow-hidden flex flex-col">
<div class="command-card-header h-10 px-6 border-b border-border-subtle flex items-center justify-between">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-slate-400 text-[16px]">terminal</span>
<span class="text-[10px] font-bold tracking-[0.1em] text-slate-500 uppercase">Commercial Underwriting System</span>
</div>
<div class="flex items-center gap-2">
<span class="relative flex h-2 w-2">
<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
<span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
</span>
<span class="text-[10px] font-bold tracking-wider text-emerald-700 uppercase bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">Live Shared View</span>
</div>
</div>
<div class="p-6 lg:p-8 flex flex-col gap-8">
<div class="flex flex-col gap-4 pb-6 border-b border-border-subtle">
<div class="flex flex-col gap-1">
<h2 class="text-2xl font-bold tracking-tight text-text-main">Underwriting Dashboard</h2>
<p class="text-text-muted text-sm font-medium">Real-time credit, structure, and risk posture</p>
</div>
<div class="flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-slate-500 font-mono bg-slate-50 p-3 rounded border border-slate-100">
<div class="flex items-center gap-2">
<span class="text-slate-400">ASSET:</span>
<span class="font-semibold text-slate-700">Highland Park Multifamily</span>
</div>
<div class="w-px h-3 bg-slate-300 hidden sm:block"></div>
<div class="flex items-center gap-2">
<span class="text-slate-400">LOAN ID:</span>
<span class="font-semibold text-slate-700">L-2948-X</span>
</div>
<div class="w-px h-3 bg-slate-300 hidden sm:block"></div>
<div class="flex items-center gap-2">
<span class="text-slate-400">LAST UPDATE:</span>
<span class="font-semibold text-slate-700">2023-10-24 14:02 UTC</span>
</div>
</div>
</div>
<div>
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Key Metrics</h3>
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
<div class="bg-white p-4 flex flex-col gap-1 hover:bg-slate-50 transition-colors">
<span class="text-[11px] font-semibold text-slate-500 uppercase">DSCR</span>
<span class="text-2xl font-bold text-text-main tracking-tight">1.25x</span>
<div class="flex items-center gap-1 mt-auto">
<span class="material-symbols-outlined text-emerald-500 text-[14px]">trending_up</span>
<span class="text-[10px] font-medium text-slate-400">+0.05 vs Target</span>
</div>
</div>
<div class="bg-white p-4 flex flex-col gap-1 hover:bg-slate-50 transition-colors">
<span class="text-[11px] font-semibold text-slate-500 uppercase">LTV</span>
<span class="text-2xl font-bold text-text-main tracking-tight">65%</span>
<div class="flex items-center gap-1 mt-auto">
<span class="material-symbols-outlined text-emerald-500 text-[14px]">trending_down</span>
<span class="text-[10px] font-medium text-slate-400">-2% vs Max</span>
</div>
</div>
<div class="bg-white p-4 flex flex-col gap-1 hover:bg-slate-50 transition-colors">
<span class="text-[11px] font-semibold text-slate-500 uppercase">Debt Yield</span>
<span class="text-2xl font-bold text-text-main tracking-tight">9.2%</span>
<div class="flex items-center gap-1 mt-auto">
<span class="material-symbols-outlined text-slate-400 text-[14px]">trending_flat</span>
<span class="text-[10px] font-medium text-slate-400">Stable</span>
</div>
</div>
<div class="bg-white p-4 flex flex-col gap-1 hover:bg-slate-50 transition-colors">
<span class="text-[11px] font-semibold text-slate-500 uppercase">NOI</span>
<span class="text-2xl font-bold text-text-main tracking-tight">$450k</span>
<div class="flex items-center gap-1 mt-auto">
<span class="material-symbols-outlined text-emerald-500 text-[14px]">trending_up</span>
<span class="text-[10px] font-medium text-slate-400">+4% YoY</span>
</div>
</div>
<div class="bg-white p-4 flex flex-col gap-1 hover:bg-slate-50 transition-colors">
<span class="text-[11px] font-semibold text-slate-500 uppercase">Occupancy</span>
<span class="text-2xl font-bold text-amber-600 tracking-tight">89%</span>
<div class="flex items-center gap-1 mt-auto">
<span class="material-symbols-outlined text-amber-500 text-[14px]">trending_down</span>
<span class="text-[10px] font-medium text-slate-400">-3% (Risk)</span>
</div>
</div>
<div class="bg-white p-4 flex flex-col gap-1 hover:bg-slate-50 transition-colors">
<span class="text-[11px] font-semibold text-slate-500 uppercase">Sponsor Score</span>
<span class="text-2xl font-bold text-text-main tracking-tight">A-</span>
<div class="flex items-center gap-1 mt-auto">
<span class="material-symbols-outlined text-slate-400 text-[14px]">check_circle</span>
<span class="text-[10px] font-medium text-slate-400">Verified</span>
</div>
</div>
</div>
</div>
<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
<div class="lg:col-span-7 flex flex-col">
<div class="flex items-center justify-between mb-3">
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Deal Specifications</h3>
<button class="text-[10px] font-semibold text-primary uppercase hover:underline">Edit Specs</button>
</div>
<div class="bg-white border border-border-subtle rounded-lg overflow-hidden">
<table class="w-full text-sm text-left">
<tbody class="divide-y divide-border-subtle">
<tr class="group hover:bg-slate-50">
<td class="py-3 px-4 text-slate-500 font-medium w-1/3">Sponsor</td>
<td class="py-3 px-4 text-text-main font-semibold text-right">Acme Capital Partners</td>
</tr>
<tr class="group hover:bg-slate-50">
<td class="py-3 px-4 text-slate-500 font-medium">Property Type</td>
<td class="py-3 px-4 text-text-main font-semibold text-right">Multifamily Class B</td>
</tr>
<tr class="group hover:bg-slate-50">
<td class="py-3 px-4 text-slate-500 font-medium">Loan Amount</td>
<td class="py-3 px-4 text-text-main font-semibold text-right">$12,500,000</td>
</tr>
<tr class="group hover:bg-slate-50">
<td class="py-3 px-4 text-slate-500 font-medium">Rate Type</td>
<td class="py-3 px-4 text-text-main font-semibold text-right">Fixed (Swap)</td>
</tr>
<tr class="group hover:bg-slate-50">
<td class="py-3 px-4 text-slate-500 font-medium">Term</td>
<td class="py-3 px-4 text-text-main font-semibold text-right">5 Years</td>
</tr>
<tr class="group hover:bg-slate-50">
<td class="py-3 px-4 text-slate-500 font-medium">Amortization</td>
<td class="py-3 px-4 text-text-main font-semibold text-right">30 Years</td>
</tr>
<tr class="group hover:bg-slate-50">
<td class="py-3 px-4 text-slate-500 font-medium">Exit Strategy</td>
<td class="py-3 px-4 text-text-main font-semibold text-right">Refinance / Sale</td>
</tr>
</tbody>
</table>
</div>
</div>
<div class="lg:col-span-5 flex flex-col gap-3">
<div class="flex items-center justify-between mb-0">
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Risk &amp; Conditions Stack</h3>
</div>
<div class="flex flex-col border border-rose-200 bg-rose-50/50 rounded-lg overflow-hidden">
<div class="bg-rose-100/50 px-4 py-2 flex items-center gap-2 border-b border-rose-100">
<span class="material-symbols-outlined text-rose-600 text-[16px]">error</span>
<span class="text-xs font-bold text-rose-700 uppercase">Missing Documents</span>
</div>
<div class="p-4">
<p class="text-sm font-medium text-rose-900">Updated Rent Roll (September)</p>
<p class="text-xs text-rose-700 mt-1">Required to finalize sizing.</p>
</div>
</div>
<div class="flex flex-col border border-amber-200 bg-amber-50/50 rounded-lg overflow-hidden">
<div class="bg-amber-100/50 px-4 py-2 flex items-center gap-2 border-b border-amber-100">
<span class="material-symbols-outlined text-amber-600 text-[16px]">warning</span>
<span class="text-xs font-bold text-amber-700 uppercase">Active Risk Flags</span>
</div>
<div class="p-4">
<p class="text-sm font-medium text-amber-900">Occupancy Dip</p>
<p class="text-xs text-amber-700 mt-1">Dipped below 90% in Q2, explanation needed.</p>
</div>
</div>
<div class="flex flex-col border border-sky-200 bg-sky-50/50 rounded-lg overflow-hidden">
<div class="bg-sky-100/50 px-4 py-2 flex items-center gap-2 border-b border-sky-100">
<span class="material-symbols-outlined text-sky-600 text-[16px]">fact_check</span>
<span class="text-xs font-bold text-sky-700 uppercase">Conditions to Close</span>
</div>
<div class="p-4">
<p class="text-sm font-medium text-sky-900">Seismic Retrofit Quote</p>
<p class="text-xs text-sky-700 mt-1">Required prior to closing.</p>
</div>
</div>
</div>
</div>
<div class="flex flex-col gap-3">
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Analyst Notes / System Output</h3>
<div class="bg-slate-50 border border-slate-200 rounded-lg p-5">
<div class="flex items-start gap-3">
<span class="material-symbols-outlined text-slate-400 mt-0.5" style="font-size: 18px;">smart_toy</span>
<div class="text-sm text-slate-600 leading-relaxed font-mono">
<p class="mb-2"><span class="font-bold text-slate-800">SYSTEM OBSERVATION:</span> The subject property demonstrates strong historical cash flow consistency. However, the recent dip in occupancy requires sponsor clarification to ensure it is not a market-wide trend. The LTV is well within guidelines at 65%, providing a comfortable equity cushion.</p>
<p><span class="font-bold text-slate-800">RECOMMENDATION:</span> Proceed with underwriting subject to receipt of updated rent roll and satisfactory explanation of occupancy variance.</p>
</div>
</div>
</div>
</div>
</div>
<div class="h-2 bg-slate-100 border-t border-slate-200"></div>
</div>
<footer class="mt-8 mb-4">
<p class="text-[11px] font-medium text-slate-400 tracking-wide uppercase opacity-70">Generated with Buddy The Underwriter</p>
</footer>
</main>`;

export default function Page() {
  redirect("/command");
  return null;
}
