import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Workout Committee Packet - Buddy";
const FONT_LINKS = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `</script>
<!-- Fonts -->
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>
<!-- Material Symbols -->
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<!-- Theme Configuration -->
<script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "primary-dark": "#0b4cb4",
                        "background-light": "#f6f7f8",
                        "background-dark": "#0f1218", // Deep charcoal
                        "surface-dark": "#1a1f29", // Slightly lighter for cards
                        "surface-darker": "#111418", // Darker panel backgrounds
                        "border-dark": "#282f39",
                        "success": "#10b981",
                        "warning": "#f59e0b",
                        "danger": "#ef4444",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "sans": ["Inter", "sans-serif"]
                    },
                    boxShadow: {
                        'glass': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                        'glow': '0 0 15px rgba(19, 109, 236, 0.15)',
                    }
                },
            },
        }`;
const STYLES = [
  "body {\n            font-family: 'Inter', sans-serif;\n        }\n        .scrollbar-hide::-webkit-scrollbar {\n            display: none;\n        }\n        .scrollbar-hide {\n            -ms-overflow-style: none;\n            scrollbar-width: none;\n        }\n        .glass-panel {\n            background-color: rgba(26, 31, 41, 0.7);\n            backdrop-filter: blur(12px);\n            border: 1px solid rgba(255, 255, 255, 0.08);\n        }\n        .thin-scrollbar::-webkit-scrollbar {\n            width: 6px;\n        }\n        .thin-scrollbar::-webkit-scrollbar-track {\n            background: #111418; \n        }\n        .thin-scrollbar::-webkit-scrollbar-thumb {\n            background: #282f39; \n            border-radius: 3px;\n        }\n        .thin-scrollbar::-webkit-scrollbar-thumb:hover {\n            background: #3e4856; \n        }"
];
const BODY_HTML = `<!-- Global Header -->
<header class="flex items-center justify-between whitespace-nowrap border-b border-border-dark bg-[#111418] px-6 py-2.5 z-50 shrink-0">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3 text-white">
<div class="size-6 text-primary">
<span class="material-symbols-outlined text-3xl">token</span>
</div>
<h2 class="text-white text-lg font-bold leading-tight tracking-tight">Buddy</h2>
</div>
<!-- Global Navigation -->
<nav class="hidden md:flex items-center gap-1">
<a class="text-gray-400 hover:text-white px-3 py-1.5 text-sm font-medium transition-colors" href="#">Deals</a>
<a class="text-gray-400 hover:text-white px-3 py-1.5 text-sm font-medium transition-colors" href="#">Intake</a>
<a class="text-gray-400 hover:text-white px-3 py-1.5 text-sm font-medium transition-colors" href="#">Portfolio</a>
<a class="text-white bg-primary/20 rounded px-3 py-1.5 text-sm font-medium transition-colors" href="#">Committee</a>
<a class="text-gray-400 hover:text-white px-3 py-1.5 text-sm font-medium transition-colors" href="#">Reporting</a>
<a class="text-gray-400 hover:text-white px-3 py-1.5 text-sm font-medium transition-colors" href="#">Servicing</a>
<a class="text-red-400 hover:text-red-300 px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1" href="#">
<span class="material-symbols-outlined text-[16px]">warning</span> Workout
                </a>
</nav>
</div>
<div class="flex flex-1 justify-end gap-6 items-center">
<!-- Search -->
<label class="hidden lg:flex flex-col min-w-40 w-64 h-9">
<div class="flex w-full flex-1 items-stretch rounded-lg h-full border border-border-dark bg-surface-dark overflow-hidden">
<div class="text-gray-400 flex items-center justify-center pl-3">
<span class="material-symbols-outlined text-[18px]">search</span>
</div>
<input class="flex w-full min-w-0 flex-1 resize-none overflow-hidden text-white focus:outline-0 focus:ring-0 border-none bg-transparent h-full placeholder:text-gray-500 px-3 text-sm font-normal" placeholder="Search loans, borrowers..."/>
</div>
</label>
<!-- Actions -->
<div class="flex gap-3 items-center">
<button class="text-gray-400 hover:text-white relative">
<span class="material-symbols-outlined">notifications</span>
<span class="absolute top-0 right-0 size-2 bg-red-500 rounded-full border-2 border-[#111418]"></span>
</button>
<div class="h-8 w-[1px] bg-border-dark mx-1"></div>
<div class="flex items-center gap-2 cursor-pointer">
<div class="bg-center bg-no-repeat bg-cover rounded-full size-8 border border-border-dark" data-alt="User Avatar" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuDcqamupBGyMKwm1DgxAMb1scFuXsi_mA_TnEZDA2DsmCrKIl5-WAx1iAVS8GIQS82-rr02wAdU63rQeUwLhyl5ht4x3rUbjjVaXzFewed0BOk1F-n3xeFHSAlJXrBwK4V1GHlaPegytip9bypHfoG3PAHOzlsOWg8Tn1vguAPRkeRKDIWmtTG2yPrzXX4OpwpGf0O-BQhzX6P-Sbqhft2Sw9RLZv3ZFzoi7n6QK6Kb_vzvGX8EPz_T-65ImjEoYt8UYjkvkRo1pYI");'></div>
<div class="flex flex-col text-xs hidden xl:flex">
<span class="text-white font-medium">S. Vance</span>
<span class="text-gray-500">CRO</span>
</div>
</div>
</div>
</div>
</header>
<!-- Main Content Grid -->
<main class="flex-1 flex overflow-hidden">
<!-- LEFT COLUMN: Navigator & Metadata (280px fixed) -->
<aside class="w-[280px] bg-surface-darker border-r border-border-dark flex flex-col shrink-0 overflow-hidden">
<div class="p-4 border-b border-border-dark">
<h1 class="text-white text-sm font-semibold uppercase tracking-wider text-gray-400 mb-1">Packet Navigator</h1>
<div class="flex items-center gap-2 text-xs text-gray-500">
<span class="material-symbols-outlined text-[14px]">folder_open</span>
<span>WK-CC-1407</span>
</div>
</div>
<div class="flex-1 overflow-y-auto thin-scrollbar p-3 space-y-1">
<!-- Nav Items -->
<a class="flex items-center justify-between px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-white group" href="#">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-primary text-[20px]">assignment</span>
<span class="text-sm font-medium">Executive Summary</span>
</div>
<span class="material-symbols-outlined text-primary text-[16px]">check_circle</span>
</a>
<a class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-all group" href="#">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-gray-500 group-hover:text-white transition-colors text-[20px]">warning</span>
<span class="text-sm font-medium">Default &amp; Status</span>
</div>
<span class="material-symbols-outlined text-gray-600 text-[16px]">check_circle</span>
</a>
<a class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-all group" href="#">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-gray-500 group-hover:text-white transition-colors text-[20px]">apartment</span>
<span class="text-sm font-medium">Collateral / Ops</span>
</div>
<span class="material-symbols-outlined text-gray-600 text-[16px]">check_circle</span>
</a>
<a class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-all group" href="#">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-gray-500 group-hover:text-white transition-colors text-[20px]">trending_up</span>
<span class="text-sm font-medium">Financial Perf.</span>
</div>
<span class="material-symbols-outlined text-gray-600 text-[16px]">check_circle</span>
</a>
<a class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-all group" href="#">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-gray-500 group-hover:text-white transition-colors text-[20px]">alt_route</span>
<span class="text-sm font-medium">Strategy Options</span>
</div>
<span class="material-symbols-outlined text-gray-600 text-[16px]">check_circle</span>
</a>
<div class="h-px bg-border-dark my-2 mx-2"></div>
<a class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-all group" href="#">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-gray-500 group-hover:text-white transition-colors text-[20px]">fact_check</span>
<span class="text-sm font-medium">Recommended Plan</span>
</div>
</a>
<a class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-all group" href="#">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-gray-500 group-hover:text-white transition-colors text-[20px]">gavel</span>
<span class="text-sm font-medium">Legal / Notices</span>
</div>
</a>
<a class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-all group" href="#">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-gray-500 group-hover:text-white transition-colors text-[20px]">attach_file</span>
<span class="text-sm font-medium">Attachments</span>
</div>
</a>
</div>
<!-- Metadata Card -->
<div class="p-4 bg-[#161b22] border-t border-border-dark text-xs space-y-3">
<div class="flex justify-between items-center text-gray-400">
<span>Case ID:</span>
<span class="text-white font-mono">CASE-98421</span>
</div>
<div class="flex justify-between items-center text-gray-400">
<span>Version:</span>
<span class="text-white bg-border-dark px-1.5 rounded text-[10px]">v2.1</span>
</div>
<div class="flex justify-between items-center text-gray-400">
<span>Quorum:</span>
<span class="text-success flex items-center gap-1">4/6 Present <span class="size-1.5 rounded-full bg-success"></span></span>
</div>
<div class="text-gray-500 pt-1 border-t border-border-dark/50">
                    Prepared by: <span class="text-gray-300">Special Assets — R. Nguyen</span>
</div>
<div class="text-gray-500">
                    Meeting: <span class="text-warning">Today 3:00 PM ET</span>
</div>
<button class="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded border border-border-dark bg-surface-dark hover:bg-[#282f39] text-gray-300 hover:text-white transition-colors text-xs font-medium">
<span class="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                    Export Packet (PDF)
                </button>
</div>
</aside>
<!-- CENTER COLUMN: Memo Narrative (Fluid) -->
<section class="flex-1 flex flex-col bg-background-dark min-w-[600px] overflow-hidden relative">
<div class="flex-1 overflow-y-auto thin-scrollbar p-8 pb-32"> <!-- Added padding bottom for fixed footer -->
<!-- Deal Header -->
<div class="mb-8 p-6 rounded-xl bg-surface-dark border border-border-dark shadow-glass relative overflow-hidden group">
<div class="absolute top-0 right-0 p-4 opacity-50">
<div class="text-[80px] leading-none text-white/5 font-bold select-none">34</div>
<div class="text-xs text-center text-white/20 font-bold uppercase tracking-widest -mt-4 mr-2">DPD</div>
</div>
<div class="flex justify-between items-start mb-4 relative z-10">
<div>
<div class="flex items-center gap-3 mb-1">
<span class="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">Active Workout</span>
<span class="text-gray-500 text-xs font-mono">ID: 9942-002</span>
</div>
<h1 class="text-2xl font-bold text-white mb-1">Harbor View Multifamily</h1>
<p class="text-gray-400 text-sm flex items-center gap-2">
<span class="material-symbols-outlined text-[16px]">domain</span> Harbor View Holdings LLC
                                <span class="mx-1 text-gray-600">•</span>
<span class="material-symbols-outlined text-[16px]">location_on</span> Boston, MA
                            </p>
</div>
<div class="text-right">
<div class="text-sm text-gray-500 mb-0.5">Unpaid Principal Balance</div>
<div class="text-2xl font-mono text-white tracking-tight">$38,600,000</div>
</div>
</div>
<div class="flex flex-wrap gap-2 mb-6 relative z-10">
<span class="inline-flex items-center px-2 py-1 rounded bg-surface-darker border border-border-dark text-xs text-gray-300">
<span class="size-2 rounded-full bg-red-500 mr-2"></span> Payment Default
                        </span>
<span class="inline-flex items-center px-2 py-1 rounded bg-surface-darker border border-border-dark text-xs text-gray-300">
<span class="size-2 rounded-full bg-orange-500 mr-2"></span> DSCR Breach
                        </span>
<span class="inline-flex items-center px-2 py-1 rounded bg-surface-darker border border-border-dark text-xs text-gray-300">
<span class="size-2 rounded-full bg-yellow-500 mr-2"></span> Maturity &lt; 30d
                        </span>
</div>
<!-- Stepper -->
<div class="relative z-10">
<div class="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-2">
<span>Triage</span>
<span class="text-primary font-bold">Forbearance</span>
<span>Modification</span>
<span>Enforcement</span>
<span>REO</span>
<span>Resolution</span>
</div>
<div class="h-1.5 w-full bg-surface-darker rounded-full overflow-hidden flex">
<div class="w-1/6 bg-primary/30 border-r border-background-dark"></div>
<div class="w-1/6 bg-primary shadow-[0_0_10px_rgba(19,109,236,0.6)] border-r border-background-dark relative">
<div class="absolute inset-0 bg-white/20 animate-pulse"></div>
</div>
<div class="w-1/6 bg-surface-darker border-r border-background-dark"></div>
<div class="w-1/6 bg-surface-darker border-r border-background-dark"></div>
<div class="w-1/6 bg-surface-darker border-r border-background-dark"></div>
<div class="w-1/6 bg-surface-darker"></div>
</div>
</div>
</div>
<!-- Executive Summary -->
<div class="space-y-6 mb-8">
<div class="flex items-center justify-between">
<h3 class="text-lg font-semibold text-white">Executive Summary</h3>
<span class="text-xs text-gray-500 bg-surface-dark px-2 py-1 rounded border border-border-dark">Last Updated: Today 09:42 AM</span>
</div>
<div class="grid grid-cols-1 gap-4">
<div class="bg-surface-dark/50 p-4 rounded-lg border border-border-dark">
<h4 class="text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wide text-xs">Situation</h4>
<p class="text-sm text-gray-400 leading-relaxed">
                                Borrower has failed to make the last two monthly debt service payments due to occupancy decline (82% vs 94% u/w) and rising operating expenses. Sponsor is requesting temporary relief to stabilize operations and complete CapEx plan.
                            </p>
</div>
<div class="grid grid-cols-2 gap-4">
<div class="bg-surface-dark/50 p-4 rounded-lg border border-border-dark">
<h4 class="text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wide text-xs">Root Causes</h4>
<ul class="list-disc list-inside text-sm text-gray-400 space-y-1">
<li>Unexpected rise in utility costs (+22% YoY)</li>
<li>Delays in unit renovation program</li>
<li>Local market supply overhang</li>
</ul>
</div>
<div class="bg-surface-dark/50 p-4 rounded-lg border border-border-dark">
<h4 class="text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wide text-xs">Recommendation</h4>
<div class="flex items-start gap-2">
<span class="material-symbols-outlined text-primary text-xl">recommend</span>
<p class="text-sm text-white font-medium leading-relaxed">
                                        Approve Forbearance Agreement with $2.5M Principal Paydown and full Cash Sweep.
                                    </p>
</div>
</div>
</div>
</div>
</div>
<!-- Key Terms Table -->
<div class="mb-8">
<h3 class="text-lg font-semibold text-white mb-4">Proposed Key Terms</h3>
<div class="overflow-hidden rounded-lg border border-border-dark">
<table class="w-full text-sm text-left text-gray-400">
<thead class="text-xs text-gray-500 uppercase bg-[#161b22] border-b border-border-dark">
<tr>
<th class="px-6 py-3 font-medium" scope="col">Term Component</th>
<th class="px-6 py-3 font-medium" scope="col">Proposed Detail</th>
<th class="px-6 py-3 font-medium text-right" scope="col">Variance from Original</th>
</tr>
</thead>
<tbody class="divide-y divide-border-dark bg-surface-dark">
<tr>
<td class="px-6 py-3 font-medium text-white">Forbearance Period</td>
<td class="px-6 py-3">12 Months (Fixed)</td>
<td class="px-6 py-3 text-right text-gray-500">N/A</td>
</tr>
<tr>
<td class="px-6 py-3 font-medium text-white">Principal Paydown</td>
<td class="px-6 py-3 text-success">$2,500,000 at execution</td>
<td class="px-6 py-3 text-right text-success">+ $2.5M</td>
</tr>
<tr>
<td class="px-6 py-3 font-medium text-white">Interest Rate</td>
<td class="px-6 py-3">SOFR + 450 bps (Floor 3.00%)</td>
<td class="px-6 py-3 text-right text-red-400">+ 50 bps</td>
</tr>
<tr>
<td class="px-6 py-3 font-medium text-white">Cash Management</td>
<td class="px-6 py-3">Hard Lockbox + Full Cash Sweep</td>
<td class="px-6 py-3 text-right text-gray-500">From Soft Lockbox</td>
</tr>
<tr>
<td class="px-6 py-3 font-medium text-white">Milestones</td>
<td class="px-6 py-3">Provide stabilized rent roll by Q3</td>
<td class="px-6 py-3 text-right text-gray-500">New Covenant</td>
</tr>
</tbody>
</table>
</div>
</div>
<!-- Risks & Mitigants -->
<div class="mb-8">
<h3 class="text-lg font-semibold text-white mb-4">Risks &amp; Mitigants</h3>
<div class="space-y-3">
<div class="flex items-start gap-4 p-4 rounded-lg bg-surface-dark border border-border-dark border-l-4 border-l-red-500">
<div class="shrink-0 pt-0.5">
<span class="material-symbols-outlined text-red-500">error</span>
</div>
<div class="flex-1">
<div class="flex items-center justify-between mb-1">
<h4 class="text-white font-medium text-sm">Sponsor Liquidity Uncertain</h4>
<span class="px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 font-bold border border-red-500/20">CRITICAL</span>
</div>
<p class="text-gray-400 text-sm mb-2">Sponsor financial statements show dwindling cash reserves across the portfolio.</p>
<div class="flex items-center gap-2 text-sm text-gray-300">
<span class="text-success font-bold">Mitigant:</span>
<span>Requiring $2.5M upfront paydown + 6 months Interest Reserve escrowed immediately.</span>
</div>
</div>
</div>
<div class="flex items-start gap-4 p-4 rounded-lg bg-surface-dark border border-border-dark border-l-4 border-l-yellow-500">
<div class="shrink-0 pt-0.5">
<span class="material-symbols-outlined text-yellow-500">warning</span>
</div>
<div class="flex-1">
<div class="flex items-center justify-between mb-1">
<h4 class="text-white font-medium text-sm">CapEx Execution Risk</h4>
<span class="px-2 py-0.5 rounded text-[10px] bg-yellow-500/10 text-yellow-400 font-bold border border-yellow-500/20">MODERATE</span>
</div>
<p class="text-gray-400 text-sm mb-2">Renovations are 4 months behind schedule due to contractor disputes.</p>
<div class="flex items-center gap-2 text-sm text-gray-300">
<span class="text-success font-bold">Mitigant:</span>
<span>Monthly construction monitoring inspections required at borrower expense.</span>
</div>
</div>
</div>
</div>
</div>
<!-- Alternatives -->
<div class="mb-4">
<h3 class="text-lg font-semibold text-white mb-4">Alternatives Considered</h3>
<div class="grid grid-cols-3 gap-4">
<!-- Option 1 -->
<div class="p-4 rounded-lg bg-surface-dark border border-border-dark opacity-60 hover:opacity-100 transition-opacity">
<h4 class="text-white font-medium text-sm mb-3">1. Immediate Enforcement</h4>
<div class="space-y-2 text-xs">
<div class="flex justify-between text-gray-400"><span>Recovery:</span> <span class="text-white">85-90%</span></div>
<div class="flex justify-between text-gray-400"><span>Timeline:</span> <span class="text-white">18-24 mos</span></div>
<div class="h-px bg-border-dark my-2"></div>
<p class="text-gray-500">High legal costs and uncertain foreclosure auction environment in Boston.</p>
</div>
</div>
<!-- Option 2 -->
<div class="p-4 rounded-lg bg-surface-dark border border-primary ring-1 ring-primary relative">
<div class="absolute -top-2.5 right-4 px-2 py-0.5 bg-primary text-white text-[10px] font-bold rounded">RECOMMENDED</div>
<h4 class="text-white font-medium text-sm mb-3">2. Forbearance + Paydown</h4>
<div class="space-y-2 text-xs">
<div class="flex justify-between text-gray-400"><span>Recovery:</span> <span class="text-success font-bold">92-98%</span></div>
<div class="flex justify-between text-gray-400"><span>Timeline:</span> <span class="text-white">6-12 mos</span></div>
<div class="h-px bg-border-dark my-2"></div>
<p class="text-gray-400">Maximizes recovery while maintaining borrower cooperation and reducing exposure.</p>
</div>
</div>
<!-- Option 3 -->
<div class="p-4 rounded-lg bg-surface-dark border border-border-dark opacity-60 hover:opacity-100 transition-opacity">
<h4 class="text-white font-medium text-sm mb-3">3. Note Sale</h4>
<div class="space-y-2 text-xs">
<div class="flex justify-between text-gray-400"><span>Recovery:</span> <span class="text-white">88-92%</span></div>
<div class="flex justify-between text-gray-400"><span>Timeline:</span> <span class="text-white">2-4 mos</span></div>
<div class="h-px bg-border-dark my-2"></div>
<p class="text-gray-500">Quick exit but likely to realize immediate loss on book value.</p>
</div>
</div>
</div>
</div>
</div>
<!-- Sticky Footer Action Bar -->
<div class="absolute bottom-0 left-0 right-0 bg-[#161b22] border-t border-border-dark px-8 py-4 z-50 shadow-glass">
<div class="flex items-center justify-between mb-2">
<div class="flex items-center gap-3">
<button class="bg-primary hover:bg-primary-dark text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-primary/20 transition-all">
                            Approve Strategy
                        </button>
<button class="bg-surface-dark hover:bg-border-dark border border-border-dark text-white px-4 py-2 rounded-lg text-sm font-medium transition-all">
                            Approve w/ Conditions
                        </button>
<button class="bg-surface-dark hover:bg-border-dark border border-border-dark text-white px-4 py-2 rounded-lg text-sm font-medium transition-all">
                            Request Revisions
                        </button>
</div>
<div class="flex items-center gap-3">
<button class="text-primary hover:text-primary-dark text-sm font-medium px-3 py-2">
                            Generate Agreement
                        </button>
<div class="h-6 w-px bg-border-dark"></div>
<button class="text-red-500 hover:text-red-400 px-4 py-2 text-sm font-medium transition-all flex items-center gap-2">
<span class="material-symbols-outlined text-[18px]">gavel</span>
                            Reject / Escalate
                        </button>
</div>
</div>
<div class="flex justify-between items-center text-[10px] text-gray-600 font-mono">
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[10px]">lock</span> Secure Connection • IP 10.2.4.19</span>
<span>Audit: Vote recorded by S. Vance at 09:42:11 AM ET • Packet v2.1</span>
</div>
</div>
</section>
<!-- RIGHT COLUMN: Decision Cockpit (340px fixed) -->
<aside class="w-[340px] bg-surface-darker border-l border-border-dark flex flex-col shrink-0 overflow-y-auto thin-scrollbar p-5 space-y-6">
<!-- Recovery Model -->
<div class="bg-surface-dark rounded-xl border border-border-dark p-4 shadow-sm">
<div class="flex items-center justify-between mb-4">
<h3 class="text-white text-sm font-semibold flex items-center gap-2">
<span class="material-symbols-outlined text-primary text-[18px]">analytics</span>
                        Recovery Model
                    </h3>
<span class="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded font-mono">LIVE</span>
</div>
<div class="space-y-4">
<div>
<div class="text-xs text-gray-500 mb-1">Current Implied Value</div>
<div class="text-2xl text-white font-mono font-medium">$52.0 MM</div>
<div class="text-[10px] text-green-500 flex items-center gap-1 mt-0.5">
<span class="material-symbols-outlined text-[12px]">trending_up</span> LTV 74.2%
                        </div>
</div>
<div class="bg-[#111418] rounded p-3 border border-border-dark space-y-2">
<div class="flex justify-between text-sm">
<span class="text-gray-400">Est. Recovery</span>
<span class="text-white font-mono">92% – 98%</span>
</div>
<div class="w-full bg-gray-800 rounded-full h-1.5">
<div class="bg-gradient-to-r from-yellow-500 to-green-500 h-1.5 rounded-full" style="width: 95%"></div>
</div>
<div class="flex justify-between text-sm pt-1">
<span class="text-gray-400">Est. Loss</span>
<span class="text-red-400 font-mono">$0.8M – $3.1M</span>
</div>
</div>
<div class="grid grid-cols-2 gap-2 text-center">
<div class="bg-[#111418] rounded p-2 border border-border-dark">
<div class="text-[10px] text-gray-500 uppercase">Time to Resolution</div>
<div class="text-white font-mono text-sm">6-12 mo</div>
</div>
<div class="bg-[#111418] rounded p-2 border border-border-dark">
<div class="text-[10px] text-gray-500 uppercase">Prob. of Cure</div>
<div class="text-primary font-mono text-sm">55%</div>
</div>
</div>
<div class="flex gap-1 flex-wrap">
<span class="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-400 border border-gray-700">Sensitivity: Base</span>
<span class="text-[10px] px-2 py-1 rounded bg-transparent text-gray-500 border border-gray-800 hover:border-gray-600 cursor-pointer">Downside</span>
<span class="text-[10px] px-2 py-1 rounded bg-transparent text-gray-500 border border-gray-800 hover:border-gray-600 cursor-pointer">Stress</span>
</div>
</div>
</div>
<!-- Approvals Required -->
<div>
<h3 class="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3 px-1">Approvals Required</h3>
<div class="space-y-2">
<div class="flex items-center justify-between p-3 rounded bg-surface-dark border border-border-dark">
<div class="flex items-center gap-3">
<div class="bg-green-500/10 p-1 rounded-full text-green-500 border border-green-500/20">
<span class="material-symbols-outlined text-[16px]">check</span>
</div>
<div class="flex flex-col">
<span class="text-white text-sm font-medium">Credit Risk</span>
<span class="text-xs text-gray-500">M. Chen approved</span>
</div>
</div>
<span class="text-[10px] font-bold text-green-500 bg-green-900/20 px-1.5 py-0.5 rounded">APPROVED</span>
</div>
<div class="flex items-center justify-between p-3 rounded bg-surface-dark border border-border-dark">
<div class="flex items-center gap-3">
<div class="bg-yellow-500/10 p-1 rounded-full text-yellow-500 border border-yellow-500/20">
<span class="material-symbols-outlined text-[16px]">hourglass_empty</span>
</div>
<div class="flex flex-col">
<span class="text-white text-sm font-medium">Legal</span>
<span class="text-xs text-gray-500">J. Reynolds reviewing</span>
</div>
</div>
<span class="text-[10px] font-bold text-yellow-500 bg-yellow-900/20 px-1.5 py-0.5 rounded">PENDING</span>
</div>
</div>
</div>
<!-- Live Voting Panel -->
<div class="relative">
<div class="flex justify-between items-center mb-3 px-1">
<h3 class="text-gray-400 text-xs font-semibold uppercase tracking-wider">Committee Voting</h3>
<span class="text-[10px] text-primary flex items-center gap-1 animate-pulse"><span class="size-1.5 rounded-full bg-primary"></span> Live</span>
</div>
<div class="space-y-3">
<!-- Voter 1 -->
<div class="p-3 bg-surface-dark rounded-lg border border-border-dark relative overflow-hidden">
<div class="absolute top-0 right-0 w-1 h-full bg-green-500"></div>
<div class="flex items-start justify-between mb-2">
<div class="flex items-center gap-2">
<img alt="voter" class="size-6 rounded-full border border-gray-600" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDNxdrD6Rzyc_Dqh_edzi9JAfNxju3kcNJ_jqsUe1-BOYNqy7QBY_nF1WHgAWJve5PtbLpABtups0gBbpqFgJSmnf6vcgQnPKRfUUVotiCoVJncgbNb3VKjAErXAM3lOmJ2w0LW5Hy3RQAiA9qWesaCG8Nto91oypRzzAC4f3psAaGi0a3oIy-Jc5jELEYK6GJpeut2znQMT-DMP6iZ5SZ3P2402NytJ7SHQYTizUhudxV3SrJzUo3Uz6EiBxTdwp1OvhiERh2NNDY"/>
<div class="flex flex-col">
<span class="text-xs font-bold text-white">Sarah Vance</span>
<span class="text-[10px] text-gray-500">Chief Risk Officer</span>
</div>
</div>
<span class="text-[10px] font-bold text-green-500">APPROVE</span>
</div>
<p class="text-[11px] text-gray-400 italic">"Given the equity cushion, forbearance is the prudent path."</p>
</div>
<!-- Voter 2 -->
<div class="p-3 bg-surface-dark rounded-lg border border-border-dark relative overflow-hidden opacity-60">
<div class="absolute top-0 right-0 w-1 h-full bg-gray-600"></div>
<div class="flex items-start justify-between mb-1">
<div class="flex items-center gap-2">
<img alt="voter" class="size-6 rounded-full border border-gray-600 grayscale" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCTXXmJ-a7QFtXi3bXffPfl3gbsRLCXJKo6_V_0d8WncBEyiSmPdHRO3cPyGLjQIQXAN22mfwpKsm7tj82fQt-DFTWRcNDVpKVpqq1fzSxUA5JD0kK3wyQ2EQLIxH5-ZZ5R4tOeGcF1Y-myKM2uF0zq_hEKYQpJTrtDv5MKx4JiD4fElOcWWmlXbqCOAYvTkvxT-2twy20EOfNnDoO8qHGsgrWecG-24ShowrZIOVg1JMBPYsChyMVOh5F_PUefbYPNkF_HMQ3YtGQ"/>
<div class="flex flex-col">
<span class="text-xs font-bold text-gray-300">David Ross</span>
<span class="text-[10px] text-gray-500">Head of Workout</span>
</div>
</div>
<span class="text-[10px] font-bold text-gray-500">WAITING</span>
</div>
</div>
<!-- Voter 3 -->
<div class="p-3 bg-surface-dark rounded-lg border border-border-dark relative overflow-hidden">
<div class="absolute top-0 right-0 w-1 h-full bg-green-500"></div>
<div class="flex items-start justify-between mb-1">
<div class="flex items-center gap-2">
<img alt="voter" class="size-6 rounded-full border border-gray-600" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBwB0m1bkJsPBzaOC9LMokowAPCdhEuc4MZUHXtIIWQPkYaybPkNnGVdgW1gj8zNSWizF2JbRfEOhP_TWSbSrKdogoXIIgaRaLIZI2wvRcsC4nM03BSE4NhTxYkOzX26B4ToWOfhd5aENOHUR94eYCKz0oGAIjdEwYsNT_FpOzx7pljYzxB5yTk4pipC-zAeMbkC6gqQHz8qSffWRkZatisSkNdBBRMT3VU3bI6w6UcHKPV_qT-HLoL7W_fDHvByWArJ-UuU03W5eo"/>
<div class="flex flex-col">
<span class="text-xs font-bold text-white">Elena Rodriguez</span>
<span class="text-[10px] text-gray-500">Credit Policy</span>
</div>
</div>
<span class="text-[10px] font-bold text-green-500">APPROVE</span>
</div>
</div>
</div>
<div class="mt-3 flex justify-between text-[10px] text-gray-500 px-1 font-mono">
<span>Threshold: 51%</span>
<span>Current: 50% (2/4)</span>
</div>
</div>
<!-- Attachments -->
<div class="pb-10">
<h3 class="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3 px-1">Evidence</h3>
<ul class="space-y-1">
<li class="flex items-center justify-between p-2 rounded hover:bg-surface-dark group cursor-pointer">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-gray-500 text-[18px]">description</span>
<span class="text-xs text-gray-300 group-hover:text-primary transition-colors">Forbearance Draft v4</span>
</div>
<span class="text-[9px] px-1.5 py-0.5 bg-blue-900/30 text-blue-400 rounded border border-blue-900/50">DRAFT</span>
</li>
<li class="flex items-center justify-between p-2 rounded hover:bg-surface-dark group cursor-pointer">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-gray-500 text-[18px]">gavel</span>
<span class="text-xs text-gray-300 group-hover:text-primary transition-colors">Demand Letter</span>
</div>
<span class="text-[9px] px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded border border-green-900/50">SENT</span>
</li>
<li class="flex items-center justify-between p-2 rounded hover:bg-surface-dark group cursor-pointer">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-gray-500 text-[18px]">table_chart</span>
<span class="text-xs text-gray-300 group-hover:text-primary transition-colors">Rent Roll (Aug)</span>
</div>
</li>
<li class="flex items-center justify-between p-2 rounded hover:bg-surface-dark group cursor-pointer">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-gray-500 text-[18px]">request_quote</span>
<span class="text-xs text-gray-300 group-hover:text-primary transition-colors">T-12 Operating</span>
</div>
</li>
</ul>
</div>
</aside>
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
