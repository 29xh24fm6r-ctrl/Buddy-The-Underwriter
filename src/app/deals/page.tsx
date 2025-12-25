import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Deals - Pipeline Command Center";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "background-light": "#f6f7f8", // Not used in this dark-only design but kept for config
                        "background-dark": "#0f1115", // Deep dark background
                        "surface-dark": "#181b21", // Slightly lighter for panels
                        "surface-glass": "rgba(24, 27, 33, 0.7)",
                        "border-dark": "#2a313c",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"]
                    },
                    boxShadow: {
                        "glass": "0 4px 30px rgba(0, 0, 0, 0.1)",
                        "glow": "0 0 15px rgba(19, 109, 236, 0.15)",
                    }
                },
            },
        }`;
const STYLES = [
  "/* Custom scrollbar for dark theme */\n        ::-webkit-scrollbar {\n            width: 6px;\n            height: 6px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #0f1115;\n        }\n        ::-webkit-scrollbar-thumb {\n            background: #2a313c;\n            border-radius: 3px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #3b4554;\n        }\n        .glass-panel {\n            background: rgba(24, 27, 33, 0.6);\n            backdrop-filter: blur(12px);\n            -webkit-backdrop-filter: blur(12px);\n            border: 1px solid rgba(255, 255, 255, 0.08);\n        }"
];
const BODY_HTML = `<!-- Top Navigation -->
<header class="h-16 shrink-0 border-b border-border-dark bg-[#111418] flex items-center justify-between px-6 z-20 relative">
<div class="flex items-center gap-6">
<div class="flex items-center gap-3 text-white">
<div class="size-8 bg-primary/20 rounded-lg flex items-center justify-center text-primary">
<span class="material-symbols-outlined" style="font-size: 20px;">security</span>
</div>
<h2 class="text-white text-lg font-bold tracking-tight">Buddy the Underwriter</h2>
</div>
</div>
<!-- Central Search -->
<div class="flex-1 max-w-xl mx-8">
<div class="relative group">
<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
<span class="material-symbols-outlined">search</span>
</div>
<input class="block w-full pl-10 pr-3 py-2.5 border-none rounded-lg leading-5 bg-[#1f242d] text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary focus:bg-[#252b36] sm:text-sm transition-colors" placeholder="Search deals, sponsors, borrowers..." type="text"/>
<div class="absolute inset-y-0 right-0 pr-2 flex items-center">
<kbd class="inline-flex items-center border border-slate-600 rounded px-2 text-sm font-sans font-medium text-slate-500">⌘K</kbd>
</div>
</div>
</div>
<!-- Right Actions -->
<div class="flex items-center gap-4">
<button class="relative p-2 text-slate-400 hover:text-white transition-colors">
<span class="material-symbols-outlined">notifications</span>
<span class="absolute top-2 right-2 size-2 bg-red-500 rounded-full border-2 border-[#111418]"></span>
</button>
<div class="h-8 w-[1px] bg-border-dark mx-1"></div>
<button class="flex items-center gap-3 hover:bg-[#1f242d] p-1.5 pl-3 rounded-lg transition-colors border border-transparent hover:border-border-dark">
<div class="text-right hidden md:block">
<p class="text-sm font-semibold text-white leading-none">Alex Underwriter</p>
<p class="text-sm text-slate-500 leading-none mt-1">Old Glory Bank</p>
</div>
<div class="size-9 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 border border-white/10" data-alt="User avatar abstract gradient"></div>
<span class="material-symbols-outlined text-slate-500">expand_more</span>
</button>
</div>
</header>
<!-- Main Layout -->
<div class="flex flex-1 overflow-hidden">
<!-- Left Nav Rail -->
<nav class="w-[72px] shrink-0 bg-[#111418] border-r border-border-dark flex flex-col items-center py-6 gap-6 z-10">
<a class="flex flex-col items-center gap-1 group w-full px-1" href="#">
<div class="p-2 rounded-lg text-slate-400 group-hover:text-white group-hover:bg-[#1f242d] transition-all">
<span class="material-symbols-outlined text-[24px]">dashboard</span>
</div>
<span class="text-[10px] font-medium text-slate-500 group-hover:text-slate-300">Home</span>
</a>
<a class="flex flex-col items-center gap-1 group w-full px-1 relative" href="#">
<div class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow"></div>
<div class="p-2 rounded-lg text-primary bg-primary/10 transition-all">
<span class="material-symbols-outlined text-[24px] fill-1">content_paste</span>
</div>
<span class="text-[10px] font-medium text-primary">Deals</span>
</a>
<a class="flex flex-col items-center gap-1 group w-full px-1" href="#">
<div class="p-2 rounded-lg text-slate-400 group-hover:text-white group-hover:bg-[#1f242d] transition-all">
<span class="material-symbols-outlined text-[24px]">input</span>
</div>
<span class="text-[10px] font-medium text-slate-500 group-hover:text-slate-300">Intake</span>
</a>
<a class="flex flex-col items-center gap-1 group w-full px-1" href="#">
<div class="p-2 rounded-lg text-slate-400 group-hover:text-white group-hover:bg-[#1f242d] transition-all">
<span class="material-symbols-outlined text-[24px]">analytics</span>
</div>
<span class="text-[10px] font-medium text-slate-500 group-hover:text-slate-300">Undrwrt</span>
</a>
<a class="flex flex-col items-center gap-1 group w-full px-1" href="#">
<div class="p-2 rounded-lg text-slate-400 group-hover:text-white group-hover:bg-[#1f242d] transition-all">
<span class="material-symbols-outlined text-[24px]">folder_open</span>
</div>
<span class="text-[10px] font-medium text-slate-500 group-hover:text-slate-300">Portfolio</span>
</a>
<div class="flex-1"></div>
<a class="flex flex-col items-center gap-1 group w-full px-1" href="#">
<div class="p-2 rounded-lg text-slate-400 group-hover:text-white group-hover:bg-[#1f242d] transition-all">
<span class="material-symbols-outlined text-[24px]">settings</span>
</div>
</a>
</nav>
<!-- Column 1: Pipeline + Filters (280px) -->
<aside class="w-[280px] shrink-0 bg-[#0f1115] border-r border-border-dark flex flex-col overflow-y-auto">
<div class="p-5 flex flex-col gap-6">
<!-- KPI Strip -->
<div class="grid grid-cols-2 gap-3">
<div class="bg-[#181b21] p-3 rounded-lg border border-border-dark/50">
<p class="text-slate-400 text-sm font-medium">Active</p>
<p class="text-white text-2xl font-bold mt-1">12</p>
</div>
<div class="bg-[#181b21] p-3 rounded-lg border border-red-900/30 relative overflow-hidden">
<div class="absolute top-0 right-0 p-1">
<span class="size-2 bg-red-500 rounded-full block"></span>
</div>
<p class="text-slate-400 text-sm font-medium">Attn Req</p>
<p class="text-white text-2xl font-bold mt-1">3</p>
</div>
<div class="bg-[#181b21] p-3 rounded-lg border border-border-dark/50">
<p class="text-slate-400 text-sm font-medium">No Docs</p>
<p class="text-white text-2xl font-bold mt-1">5</p>
</div>
<div class="bg-[#181b21] p-3 rounded-lg border border-border-dark/50">
<p class="text-slate-400 text-sm font-medium">Risks</p>
<p class="text-white text-2xl font-bold mt-1">2</p>
</div>
</div>
<!-- Pipeline Stages -->
<div class="flex flex-col gap-3">
<h3 class="text-white text-sm font-bold uppercase tracking-wider text-opacity-60">Pipeline Stage</h3>
<div class="flex flex-wrap gap-2">
<button class="px-3 py-1.5 rounded-full text-sm font-medium bg-primary/20 text-primary border border-primary/30">Intake</button>
<button class="px-3 py-1.5 rounded-full text-sm font-medium bg-[#1f242d] text-slate-400 border border-transparent hover:border-slate-600">Underwriting</button>
<button class="px-3 py-1.5 rounded-full text-sm font-medium bg-[#1f242d] text-slate-400 border border-transparent hover:border-slate-600">Committee</button>
<button class="px-3 py-1.5 rounded-full text-sm font-medium bg-[#1f242d] text-slate-400 border border-transparent hover:border-slate-600">Closing</button>
<button class="px-3 py-1.5 rounded-full text-sm font-medium bg-[#1f242d] text-slate-400 border border-transparent hover:border-slate-600">Servicing</button>
</div>
</div>
<div class="h-[1px] bg-border-dark w-full"></div>
<!-- Filters Accordions -->
<div class="flex flex-col gap-2">
<h3 class="text-white text-sm font-bold uppercase tracking-wider text-opacity-60 mb-2">Filters</h3>
<!-- Asset Type -->
<details class="group" open="">
<summary class="flex cursor-pointer items-center justify-between py-2 list-none text-slate-200 font-medium hover:text-white">
<span>Asset Type</span>
<span class="material-symbols-outlined transition-transform group-open:rotate-180">expand_more</span>
</summary>
<div class="pb-3 pt-1 pl-2 flex flex-col gap-2">
<label class="flex items-center gap-3 cursor-pointer">
<input checked="" class="form-checkbox rounded bg-[#1f242d] border-slate-600 text-primary focus:ring-0 focus:ring-offset-0" type="checkbox"/>
<span class="text-sm text-slate-300">Multifamily</span>
</label>
<label class="flex items-center gap-3 cursor-pointer">
<input class="form-checkbox rounded bg-[#1f242d] border-slate-600 text-primary focus:ring-0 focus:ring-offset-0" type="checkbox"/>
<span class="text-sm text-slate-300">Industrial</span>
</label>
<label class="flex items-center gap-3 cursor-pointer">
<input class="form-checkbox rounded bg-[#1f242d] border-slate-600 text-primary focus:ring-0 focus:ring-offset-0" type="checkbox"/>
<span class="text-sm text-slate-300">Retail</span>
</label>
<label class="flex items-center gap-3 cursor-pointer">
<input class="form-checkbox rounded bg-[#1f242d] border-slate-600 text-primary focus:ring-0 focus:ring-offset-0" type="checkbox"/>
<span class="text-sm text-slate-300">Office</span>
</label>
</div>
</details>
<!-- Status -->
<details class="group">
<summary class="flex cursor-pointer items-center justify-between py-2 list-none text-slate-200 font-medium hover:text-white">
<span>Status</span>
<span class="material-symbols-outlined transition-transform group-open:rotate-180">expand_more</span>
</summary>
<div class="pb-3 pt-1 pl-2 flex flex-col gap-2">
<label class="flex items-center gap-3 cursor-pointer">
<input class="form-checkbox rounded bg-[#1f242d] border-slate-600 text-primary focus:ring-0 focus:ring-offset-0" type="checkbox"/>
<span class="text-sm text-slate-300">Needs Attention</span>
</label>
</div>
</details>
<!-- Quick Toggles -->
<div class="mt-4 flex flex-col gap-4">
<div class="flex items-center justify-between">
<span class="text-sm text-slate-300">Only SLA Breaches</span>
<button class="relative inline-flex h-5 w-9 items-center rounded-full bg-[#2a313c]">
<span class="inline-block h-3 w-3 transform rounded-full bg-slate-400 transition translate-x-1"></span>
</button>
</div>
<div class="flex items-center justify-between">
<span class="text-sm text-slate-300">Only New Uploads</span>
<button class="relative inline-flex h-5 w-9 items-center rounded-full bg-primary/20">
<span class="inline-block h-3 w-3 transform rounded-full bg-primary transition translate-x-5"></span>
</button>
</div>
</div>
</div>
</div>
</aside>
<!-- Column 2: Deals Table (Fluid) -->
<main class="flex-1 min-w-0 bg-[#0f1115] relative flex flex-col">
<!-- Table Header Toolbar -->
<div class="px-6 py-4 flex items-center justify-between border-b border-border-dark shrink-0">
<div class="flex items-center gap-4">
<h1 class="text-xl font-bold text-white">Active Deals</h1>
<div class="flex items-center gap-2 text-sm text-slate-400 bg-[#181b21] px-3 py-1 rounded-md border border-border-dark">
<span>Sort by:</span>
<span class="text-white font-medium cursor-pointer">Last Updated</span>
<span class="material-symbols-outlined text-[16px]">expand_more</span>
</div>
</div>
<button class="flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium shadow-glow transition-all">
<span class="material-symbols-outlined text-[20px]">add</span>
                    New Deal
                </button>
</div>
<!-- Table Container -->
<div class="flex-1 overflow-auto">
<table class="w-full text-left border-collapse">
<thead class="sticky top-0 z-10 bg-[#0f1115] shadow-sm">
<tr>
<th class="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-border-dark">Deal Name</th>
<th class="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-border-dark">Sponsor</th>
<th class="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-border-dark text-right">Loan Amt</th>
<th class="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-border-dark text-right">DSCR</th>
<th class="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-border-dark text-right">LTV</th>
<th class="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-border-dark text-center">Risk</th>
<th class="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-border-dark">Stage</th>
<th class="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-border-dark text-right">Updated</th>
</tr>
</thead>
<tbody class="divide-y divide-border-dark/50">
<!-- Row 1: Selected -->
<tr class="group hover:bg-[#181b21] transition-colors cursor-pointer bg-primary/5 border-l-2 border-l-primary relative">
<td class="px-6 py-4">
<div class="flex flex-col">
<span class="text-white font-semibold text-base">Highland Apartments Refi</span>
<span class="text-slate-500 text-sm">Austin, TX • Multifamily</span>
</div>
<!-- Quick Actions Overlay -->
<div class="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-[#181b21] via-[#181b21] to-transparent opacity-0 group-hover:opacity-100 flex items-center justify-end px-6 gap-2 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
<button class="bg-[#2a313c] hover:bg-primary hover:text-white text-slate-300 p-2 rounded-md shadow-lg" title="Open Deal">
<span class="material-symbols-outlined text-[18px]">open_in_new</span>
</button>
<button class="bg-[#2a313c] hover:bg-primary hover:text-white text-slate-300 p-2 rounded-md shadow-lg" title="Request Docs">
<span class="material-symbols-outlined text-[18px]">mail</span>
</button>
</div>
</td>
<td class="px-6 py-4 text-sm text-slate-300">Greystar Real Estate</td>
<td class="px-6 py-4 text-base font-medium text-white text-right tabular-nums">$45.0M</td>
<td class="px-6 py-4 text-sm text-green-400 font-medium text-right tabular-nums">1.25x</td>
<td class="px-6 py-4 text-sm text-slate-300 text-right tabular-nums">65%</td>
<td class="px-6 py-4 text-center">
<span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">A-</span>
</td>
<td class="px-6 py-4">
<span class="text-sm text-slate-300 bg-[#2a313c] px-2 py-1 rounded">Intake</span>
</td>
<td class="px-6 py-4 text-sm text-slate-500 text-right">2m ago</td>
</tr>
<!-- Row 2 -->
<tr class="group hover:bg-[#181b21] transition-colors cursor-pointer border-l-2 border-l-transparent">
<td class="px-6 py-4 relative">
<div class="flex flex-col">
<span class="text-white font-semibold text-base">Harbor Point Multifamily</span>
<span class="text-slate-500 text-sm">Baltimore, MD • Multifamily</span>
</div>
<div class="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-[#181b21] via-[#181b21] to-transparent opacity-0 group-hover:opacity-100 flex items-center justify-end px-6 gap-2 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
<button class="bg-[#2a313c] hover:bg-primary hover:text-white text-slate-300 p-2 rounded-md shadow-lg">
<span class="material-symbols-outlined text-[18px]">open_in_new</span>
</button>
<button class="bg-[#2a313c] hover:bg-primary hover:text-white text-slate-300 p-2 rounded-md shadow-lg">
<span class="material-symbols-outlined text-[18px]">mail</span>
</button>
</div>
</td>
<td class="px-6 py-4 text-sm text-slate-300">Beatty Development</td>
<td class="px-6 py-4 text-base font-medium text-white text-right tabular-nums">$22.5M</td>
<td class="px-6 py-4 text-sm text-green-400 font-medium text-right tabular-nums">1.30x</td>
<td class="px-6 py-4 text-sm text-slate-300 text-right tabular-nums">72%</td>
<td class="px-6 py-4 text-center">
<span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">B+</span>
</td>
<td class="px-6 py-4">
<span class="text-sm text-slate-300 bg-[#2a313c] px-2 py-1 rounded">Underwriting</span>
</td>
<td class="px-6 py-4 text-sm text-slate-500 text-right">4h ago</td>
</tr>
<!-- Row 3 -->
<tr class="group hover:bg-[#181b21] transition-colors cursor-pointer border-l-2 border-l-transparent">
<td class="px-6 py-4 relative">
<div class="flex flex-col">
<span class="text-white font-semibold text-base">Oak Creek Industrial</span>
<span class="text-slate-500 text-sm">Columbus, OH • Industrial</span>
</div>
</td>
<td class="px-6 py-4 text-sm text-slate-300">Prologis Inc.</td>
<td class="px-6 py-4 text-base font-medium text-white text-right tabular-nums">$18.2M</td>
<td class="px-6 py-4 text-sm text-red-400 font-medium text-right tabular-nums">1.10x</td>
<td class="px-6 py-4 text-sm text-slate-300 text-right tabular-nums">60%</td>
<td class="px-6 py-4 text-center">
<span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">B-</span>
</td>
<td class="px-6 py-4">
<span class="text-sm text-slate-300 bg-[#2a313c] px-2 py-1 rounded">Intake</span>
</td>
<td class="px-6 py-4 text-sm text-slate-500 text-right">1d ago</td>
</tr>
<!-- Row 4 -->
<tr class="group hover:bg-[#181b21] transition-colors cursor-pointer border-l-2 border-l-transparent">
<td class="px-6 py-4 relative">
<div class="flex flex-col">
<span class="text-white font-semibold text-base">Lakeside Offices</span>
<span class="text-slate-500 text-sm">Chicago, IL • Office</span>
</div>
</td>
<td class="px-6 py-4 text-sm text-slate-300">Hines Global</td>
<td class="px-6 py-4 text-base font-medium text-white text-right tabular-nums">$65.0M</td>
<td class="px-6 py-4 text-sm text-slate-400 font-medium text-right tabular-nums">-</td>
<td class="px-6 py-4 text-sm text-slate-300 text-right tabular-nums">-</td>
<td class="px-6 py-4 text-center">
<span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-slate-700/50 text-slate-300 border border-slate-600/30">Inc</span>
</td>
<td class="px-6 py-4">
<span class="text-sm text-slate-300 bg-[#2a313c] px-2 py-1 rounded">Intake</span>
</td>
<td class="px-6 py-4 text-sm text-slate-500 text-right">2d ago</td>
</tr>
</tbody>
</table>
</div>
</main>
<!-- Column 3: Deal Intelligence Drawer (360px) -->
<aside class="w-[360px] shrink-0 bg-[#111418] border-l border-border-dark flex flex-col overflow-y-auto">
<!-- Selected Deal Header -->
<div class="p-6 border-b border-border-dark bg-[#111418] sticky top-0 z-10">
<div class="flex items-start justify-between mb-4">
<div>
<div class="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Active Selection</div>
<h2 class="text-xl font-bold text-white leading-tight">Highland Apts Refi</h2>
<p class="text-slate-400 text-sm mt-1">Austin, TX</p>
</div>
<button class="text-slate-500 hover:text-white">
<span class="material-symbols-outlined">close</span>
</button>
</div>
<div class="flex items-center gap-4 mb-5">
<div class="bg-[#1f242d] px-3 py-1.5 rounded border border-border-dark">
<span class="text-xs text-slate-400 block">Loan Amount</span>
<span class="text-sm font-semibold text-white">$45,000,000</span>
</div>
<div class="bg-[#1f242d] px-3 py-1.5 rounded border border-border-dark">
<span class="text-xs text-slate-400 block">Stage</span>
<span class="text-sm font-semibold text-white">Intake</span>
</div>
</div>
<button class="w-full bg-primary hover:bg-blue-600 text-white font-semibold py-2.5 rounded-lg transition-colors shadow-glow flex items-center justify-center gap-2">
                    Resume Underwriting
                    <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
</button>
</div>
<!-- Content -->
<div class="p-6 flex flex-col gap-8">
<!-- Next Best Action -->
<div class="flex flex-col gap-3">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-purple-400 text-[20px]">psychology</span>
<h3 class="text-sm font-bold text-white uppercase tracking-wide">Next Best Action</h3>
</div>
<div class="glass-panel p-4 rounded-xl border border-purple-500/20 bg-gradient-to-b from-purple-500/5 to-transparent relative overflow-hidden group">
<div class="absolute top-0 right-0 p-2 opacity-50">
<span class="material-symbols-outlined text-purple-400">auto_awesome</span>
</div>
<h4 class="text-white font-semibold mb-1 relative z-10">Review Appraisal Gap</h4>
<p class="text-sm text-slate-400 mb-4 relative z-10">Valuation came in 5% lower than sponsor estimate. Review comparables.</p>
<button class="w-full bg-[#1f242d] hover:bg-[#2a313c] border border-border-dark text-white text-sm font-medium py-2 rounded-lg transition-colors">
                            Review Comps
                        </button>
</div>
</div>
<!-- Live Intelligence Feed -->
<div class="flex flex-col gap-3">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-blue-400 text-[20px]">history</span>
<h3 class="text-sm font-bold text-white uppercase tracking-wide">Live Intelligence</h3>
</div>
<div class="relative pl-2">
<!-- Vertical Line -->
<div class="absolute left-[7px] top-2 bottom-0 w-[2px] bg-border-dark"></div>
<!-- Item 1 -->
<div class="relative pl-6 pb-6">
<div class="absolute left-0 top-1 size-4 bg-[#111418] border-2 border-primary rounded-full z-10"></div>
<p class="text-sm text-white font-medium">New Rent Roll Uploaded</p>
<p class="text-xs text-slate-500 mt-0.5">Detected via Email integration</p>
<p class="text-xs text-slate-600 mt-1">2 mins ago</p>
</div>
<!-- Item 2 -->
<div class="relative pl-6 pb-6">
<div class="absolute left-0 top-1 size-4 bg-[#111418] border-2 border-green-500 rounded-full z-10"></div>
<p class="text-sm text-white font-medium">OCR Extraction Complete</p>
<p class="text-xs text-slate-500 mt-0.5">T-12 Operating Statement processed successfully.</p>
<p class="text-xs text-slate-600 mt-1">15 mins ago</p>
</div>
<!-- Item 3 -->
<div class="relative pl-6 pb-2">
<div class="absolute left-0 top-1 size-4 bg-[#111418] border-2 border-orange-500 rounded-full z-10"></div>
<p class="text-sm text-white font-medium">Policy Exception Flagged</p>
<p class="text-xs text-slate-500 mt-0.5">Debt yield below minimum threshold (8.5%).</p>
<p class="text-xs text-slate-600 mt-1">1 hour ago</p>
</div>
</div>
</div>
<!-- Conditions Checklist -->
<div class="flex flex-col gap-3">
<div class="flex items-center justify-between">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-slate-400 text-[20px]">checklist</span>
<h3 class="text-sm font-bold text-white uppercase tracking-wide">Conditions</h3>
</div>
<span class="text-xs font-medium text-slate-500">2/5 Done</span>
</div>
<div class="flex flex-col gap-2">
<div class="flex items-start gap-3 p-2 hover:bg-[#1f242d] rounded transition-colors group">
<div class="mt-0.5 text-green-500">
<span class="material-symbols-outlined text-[20px]">check_circle</span>
</div>
<div class="flex-1">
<p class="text-sm text-slate-400 line-through decoration-slate-600">Borrower Financials</p>
</div>
</div>
<div class="flex items-start gap-3 p-2 hover:bg-[#1f242d] rounded transition-colors group">
<div class="mt-0.5 text-green-500">
<span class="material-symbols-outlined text-[20px]">check_circle</span>
</div>
<div class="flex-1">
<p class="text-sm text-slate-400 line-through decoration-slate-600">KYC Clearance</p>
</div>
</div>
<div class="flex items-start gap-3 p-2 hover:bg-[#1f242d] rounded transition-colors group">
<div class="mt-0.5 text-slate-600 group-hover:text-slate-400">
<span class="material-symbols-outlined text-[20px]">radio_button_unchecked</span>
</div>
<div class="flex-1">
<p class="text-sm text-white">Environmental Phase I</p>
<p class="text-xs text-red-400 mt-0.5">Due Tomorrow</p>
</div>
</div>
<div class="flex items-start gap-3 p-2 hover:bg-[#1f242d] rounded transition-colors group">
<div class="mt-0.5 text-slate-600 group-hover:text-slate-400">
<span class="material-symbols-outlined text-[20px]">radio_button_unchecked</span>
</div>
<div class="flex-1">
<p class="text-sm text-white">Appraisal Review</p>
<p class="text-xs text-slate-500 mt-0.5">Due Oct 24</p>
</div>
</div>
</div>
</div>
</div>
</aside>
</div>`;

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
