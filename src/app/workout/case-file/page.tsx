import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Buddy - Workout Case File Resolution Cockpit";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "primary-dark": "#0b5ed7",
                        "background-light": "#f6f7f8",
                        "background-dark": "#101822",
                        "card-dark": "#18212f",
                        "border-dark": "#2a3441",
                        "status-green": "#0bda5e",
                        "status-red": "#ef4444",
                        "status-amber": "#f59e0b",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "mono": ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
                    },
                    boxShadow: {
                        "glow": "0 0 10px rgba(19, 109, 236, 0.3)",
                        "premium": "0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.3)",
                    }
                },
            },
        }`;
const STYLES = [
  "/* Custom scrollbar for high density layout */\n        ::-webkit-scrollbar {\n            width: 8px;\n            height: 8px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #101822; \n        }\n        ::-webkit-scrollbar-thumb {\n            background: #2a3441; \n            border-radius: 4px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #3b4758; \n        }\n        \n        .glass-panel {\n            background: rgba(24, 33, 47, 0.95);\n            backdrop-filter: blur(10px);\n            border-top: 1px solid rgba(255, 255, 255, 0.08);\n        }\n\n        .no-scrollbar::-webkit-scrollbar {\n            display: none;\n        }\n        .no-scrollbar {\n            -ms-overflow-style: none;\n            scrollbar-width: none;\n        }"
];
const BODY_HTML = `<!-- Global Header -->
<header class="flex items-center justify-between whitespace-nowrap border-b border-solid border-border-dark bg-[#111418] px-6 py-3 shrink-0 z-30">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3 text-white">
<div class="size-5 text-primary">
<svg fill="none" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_6_330)">
<path clip-rule="evenodd" d="M24 0.757355L47.2426 24L24 47.2426L0.757355 24L24 0.757355ZM21 35.7574V12.2426L9.24264 24L21 35.7574Z" fill="currentColor" fill-rule="evenodd"></path>
</g>
<defs>
<clippath id="clip0_6_330"><rect fill="white" height="48" width="48"></rect></clippath>
</defs>
</svg>
</div>
<h2 class="text-white text-lg font-bold leading-tight tracking-tight">Buddy</h2>
</div>
<!-- Global Nav -->
<nav class="hidden md:flex items-center gap-6">
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Deals</a>
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Intake</a>
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Portfolio</a>
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Committee</a>
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Reporting</a>
</nav>
</div>
<div class="flex flex-1 justify-end gap-6 items-center">
<div class="relative hidden lg:block w-64 group">
<div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-500 group-focus-within:text-primary transition-colors">
<span class="material-symbols-outlined text-[20px]">search</span>
</div>
<input class="block w-full p-2 pl-10 text-sm text-white bg-[#1c232d] border border-border-dark rounded-md focus:ring-1 focus:ring-primary focus:border-primary placeholder-slate-500 transition-all" placeholder="Search loans, borrowers..." type="text"/>
</div>
<div class="flex gap-2 items-center">
<button class="flex items-center justify-center size-9 rounded-md bg-[#1c232d] text-slate-400 hover:text-white hover:bg-border-dark transition-colors relative">
<span class="material-symbols-outlined text-[20px]">notifications</span>
<span class="absolute top-2 right-2 size-2 bg-status-red rounded-full border border-[#1c232d]"></span>
</button>
<div class="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-8 border border-border-dark cursor-pointer ml-2" data-alt="User Avatar" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuBaBgsVgDx_5d_4BhlFrY8hYj1Q-ISEYgYbkJ4EfXn5NKHkO_KCwakuje7Jl8ZxUnGOM17nV9TDlstuZ4P12Yc60_l7oZOW6g-IplToJqBeNvs8uQ9Oy-PdRapgCX3zoaoYpyeywKNxnckHUfgV0lheCdThdLEVEd2YvFP5vi_dZ55wHHua4XmVEEajqGPq8s2Cr7IrBITC4ezaD8zHAgdczTXJPyhPWq0eXbJl0QJofHCb95o-jqLnLU_l7xB-mBTa9Vzq10Gj1M0");'></div>
</div>
</div>
</header>
<!-- Main Content Area -->
<main class="flex-1 flex flex-col overflow-hidden relative">
<!-- Case Header (Sticky) -->
<section class="bg-[#111418] border-b border-border-dark px-6 py-4 shrink-0 shadow-premium z-20">
<!-- Breadcrumbs -->
<div class="flex items-center gap-2 text-xs font-medium text-slate-500 mb-2">
<a class="hover:text-slate-300" href="#">Portfolio</a>
<span class="material-symbols-outlined text-[12px]">chevron_right</span>
<a class="hover:text-slate-300" href="#">Workout</a>
<span class="material-symbols-outlined text-[12px]">chevron_right</span>
<span class="text-white">Case #492-BX</span>
</div>
<div class="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
<!-- Left: Title & Context -->
<div class="flex-1 min-w-0">
<div class="flex items-center gap-3 mb-1">
<h1 class="text-2xl font-black text-white tracking-tight leading-none">Crestview Logistics Center</h1>
<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-status-red/20 text-status-red border border-status-red/30">Enforcement</span>
</div>
<p class="text-slate-400 text-sm font-medium truncate">Borrower: Crestview Holdings LLC • 492 Crestview Blvd, Austin, TX</p>
</div>
<!-- Middle: Stats Grid -->
<div class="flex gap-4 lg:gap-8 bg-[#1c232d] px-4 py-2 rounded-lg border border-border-dark">
<div class="flex flex-col">
<span class="text-[10px] uppercase tracking-wider text-slate-500 font-bold">UPB</span>
<span class="text-lg font-mono font-bold text-white">$14,250,000</span>
</div>
<div class="w-px bg-border-dark"></div>
<div class="flex flex-col">
<span class="text-[10px] uppercase tracking-wider text-slate-500 font-bold">DPD</span>
<div class="flex items-baseline gap-2">
<span class="text-lg font-mono font-bold text-status-red">65 Days</span>
<span class="text-xs text-status-red/80 font-medium">+12</span>
</div>
</div>
<div class="w-px bg-border-dark"></div>
<div class="flex flex-col">
<span class="text-[10px] uppercase tracking-wider text-slate-500 font-bold">LTV</span>
<span class="text-lg font-mono font-bold text-status-amber">78.5%</span>
</div>
<div class="w-px bg-border-dark"></div>
<div class="flex flex-col">
<span class="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Note Rate</span>
<span class="text-lg font-mono font-bold text-white">6.25%</span>
</div>
</div>
<!-- Right: Stepper -->
<div class="flex-1 flex justify-end min-w-[400px]">
<div class="w-full max-w-xl">
<div class="flex justify-between items-center relative">
<!-- Line Background -->
<div class="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-[#2a3441] z-0"></div>
<!-- Steps -->
<div class="relative z-10 flex flex-col items-center gap-1 group">
<div class="size-3 rounded-full bg-slate-600 outline outline-4 outline-[#111418]"></div>
<span class="text-[10px] font-medium text-slate-500 uppercase">Triage</span>
</div>
<div class="relative z-10 flex flex-col items-center gap-1 group">
<div class="size-3 rounded-full bg-slate-600 outline outline-4 outline-[#111418]"></div>
<span class="text-[10px] font-medium text-slate-500 uppercase">Forbearance</span>
</div>
<div class="relative z-10 flex flex-col items-center gap-1 group">
<div class="size-3 rounded-full bg-slate-600 outline outline-4 outline-[#111418]"></div>
<span class="text-[10px] font-medium text-slate-500 uppercase">Modification</span>
</div>
<!-- Active Step -->
<div class="relative z-10 flex flex-col items-center gap-1 group">
<div class="size-4 rounded-full bg-primary outline outline-4 outline-[#111418] shadow-glow ring-2 ring-primary/30"></div>
<span class="text-[10px] font-bold text-primary uppercase">Enforcement</span>
</div>
<div class="relative z-10 flex flex-col items-center gap-1 group">
<div class="size-3 rounded-full bg-[#1c232d] border border-slate-600 outline outline-4 outline-[#111418]"></div>
<span class="text-[10px] font-medium text-slate-600 uppercase">REO</span>
</div>
<div class="relative z-10 flex flex-col items-center gap-1 group">
<div class="size-3 rounded-full bg-[#1c232d] border border-slate-600 outline outline-4 outline-[#111418]"></div>
<span class="text-[10px] font-medium text-slate-600 uppercase">Resolution</span>
</div>
</div>
</div>
</div>
</div>
</section>
<!-- Cockpit Grid (Scrollable) -->
<div class="flex-1 overflow-y-auto overflow-x-hidden p-6 pb-24">
<div class="grid grid-cols-12 gap-6 max-w-[1600px] mx-auto">
<!-- Column 1: Strategy & Financials (4 cols) -->
<div class="col-span-12 lg:col-span-4 flex flex-col gap-6">
<!-- Resolution Plan -->
<div class="bg-card-dark rounded-lg border border-border-dark p-5 shadow-sm">
<div class="flex items-center justify-between mb-4">
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
<span class="material-symbols-outlined text-sm">strategy</span> Resolution Plan
                            </h3>
<button class="text-primary hover:text-white transition-colors"><span class="material-symbols-outlined text-sm">edit</span></button>
</div>
<div class="space-y-4">
<div class="p-3 bg-primary/10 border border-primary/20 rounded-md">
<span class="block text-[10px] font-bold text-primary mb-1 uppercase tracking-wide">Primary Strategy</span>
<p class="text-white font-medium text-sm">Deed-in-Lieu of Foreclosure</p>
<p class="text-slate-400 text-xs mt-1">Consensual transfer to avoid lengthy litigation. Borrower showing cooperation.</p>
</div>
<div class="p-3 bg-[#1c232d] border border-border-dark rounded-md opacity-70">
<span class="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wide">Backup Strategy</span>
<p class="text-slate-300 font-medium text-sm">Non-Judicial Foreclosure</p>
<p class="text-slate-500 text-xs mt-1">Notice of Default filed. Trustee sale scheduled for Nov 15 if DIL fails.</p>
</div>
<div class="mt-4">
<h4 class="text-[10px] font-bold text-slate-500 uppercase mb-2">Decision Log</h4>
<ul class="space-y-2">
<li class="flex gap-2 items-start text-xs">
<span class="material-symbols-outlined text-sm text-status-green">check_circle</span>
<div>
<span class="text-white block">Approve Pre-Negotiation Letter</span>
<span class="text-slate-500 text-[10px]">Sep 02 • Committee</span>
</div>
</li>
<li class="flex gap-2 items-start text-xs">
<span class="material-symbols-outlined text-sm text-status-amber">pending</span>
<div>
<span class="text-white block">Receiver Appointment</span>
<span class="text-slate-500 text-[10px]">Due Oct 14 • Legal</span>
</div>
</li>
</ul>
</div>
</div>
</div>
<!-- Recoveries Model -->
<div class="bg-card-dark rounded-lg border border-border-dark p-5 shadow-sm flex-1">
<div class="flex items-center justify-between mb-4">
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
<span class="material-symbols-outlined text-sm">analytics</span> Recoveries Model
                            </h3>
<span class="text-[10px] font-mono text-slate-500">Last updated: Today 09:42</span>
</div>
<div class="space-y-5">
<!-- Scenario Bars -->
<div class="space-y-3">
<div class="flex items-end justify-between text-xs mb-1">
<span class="text-slate-400">Net Recovery (Base Case)</span>
<span class="text-white font-mono font-bold">$12.8M <span class="text-slate-500 font-normal">(90%)</span></span>
</div>
<div class="w-full h-2 bg-[#2a3441] rounded-full overflow-hidden flex">
<div class="h-full bg-status-green w-[20%]"></div>
<div class="h-full bg-primary w-[50%]"></div>
<div class="h-full bg-status-red w-[20%]"></div>
</div>
<div class="flex justify-between text-[10px] text-slate-500 font-mono">
<span>Worst: $10.1M</span>
<span>Best: $13.9M</span>
</div>
</div>
<div class="grid grid-cols-2 gap-3">
<div class="bg-[#1c232d] p-3 rounded border border-border-dark">
<span class="block text-[10px] text-slate-500 uppercase">Est. Timeline</span>
<span class="text-lg font-mono font-bold text-white">9 Months</span>
</div>
<div class="bg-[#1c232d] p-3 rounded border border-border-dark">
<span class="block text-[10px] text-slate-500 uppercase">Cost to Resolve</span>
<span class="text-lg font-mono font-bold text-white">$450k</span>
</div>
</div>
<!-- Sensitivity Chips -->
<div>
<span class="block text-[10px] font-bold text-slate-500 uppercase mb-2">Sensitivity Analysis (Stress Test)</span>
<div class="flex flex-wrap gap-2">
<button class="px-2 py-1 rounded bg-primary/20 text-primary border border-primary/30 text-[10px] font-medium hover:bg-primary hover:text-white transition-all cursor-pointer">
                                        Cap Rate 6.5% (+0.5%)
                                    </button>
<button class="px-2 py-1 rounded bg-[#1c232d] text-slate-400 border border-border-dark text-[10px] font-medium hover:text-white hover:border-slate-500 transition-all cursor-pointer">
                                        Rent Growth 0%
                                    </button>
<button class="px-2 py-1 rounded bg-[#1c232d] text-slate-400 border border-border-dark text-[10px] font-medium hover:text-white hover:border-slate-500 transition-all cursor-pointer">
                                        Downtime 12mo
                                    </button>
</div>
</div>
</div>
</div>
</div>
<!-- Column 2: Legal & Ops (4 cols) -->
<div class="col-span-12 lg:col-span-4 flex flex-col gap-6">
<!-- Legal & Notices -->
<div class="bg-card-dark rounded-lg border border-border-dark p-5 shadow-sm">
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
<span class="material-symbols-outlined text-sm">gavel</span> Legal &amp; Notices
                        </h3>
<div class="flex justify-between items-center bg-[#1c232d] p-3 rounded mb-4 border border-border-dark">
<div class="flex items-center gap-3">
<div class="size-8 rounded bg-slate-700 flex items-center justify-center text-white font-bold text-xs">LW</div>
<div>
<div class="text-xs font-bold text-white">Latham &amp; Watkins</div>
<div class="text-[10px] text-slate-400">Partner: J. Doe</div>
</div>
</div>
<a class="text-[10px] text-primary hover:underline" href="#">Contact</a>
</div>
<ul class="divide-y divide-border-dark">
<li class="py-3 flex justify-between items-center group cursor-pointer hover:bg-[#1c232d] px-2 -mx-2 rounded transition-colors">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-slate-500 text-lg">mail</span>
<div>
<span class="block text-xs font-medium text-white">Demand Letter</span>
<span class="block text-[10px] text-slate-500">Sent Sep 01, 2023</span>
</div>
</div>
<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-900/40 text-green-400 border border-green-800">Sent</span>
</li>
<li class="py-3 flex justify-between items-center group cursor-pointer hover:bg-[#1c232d] px-2 -mx-2 rounded transition-colors">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-slate-500 text-lg">description</span>
<div>
<span class="block text-xs font-medium text-white">Notice of Default</span>
<span class="block text-[10px] text-slate-500">Filed Sep 15, 2023</span>
</div>
</div>
<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-900/40 text-green-400 border border-green-800">Filed</span>
</li>
<li class="py-3 flex justify-between items-center group cursor-pointer hover:bg-[#1c232d] px-2 -mx-2 rounded transition-colors">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-slate-500 text-lg">folder_off</span>
<div>
<span class="block text-xs font-medium text-white">Forbearance Agmt</span>
<span class="block text-[10px] text-slate-500">Drafting in progress</span>
</div>
</div>
<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-900/40 text-amber-400 border border-amber-800">Draft</span>
</li>
</ul>
</div>
<!-- Collateral Ops -->
<div class="bg-card-dark rounded-lg border border-border-dark p-5 shadow-sm flex-1">
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
<span class="material-symbols-outlined text-sm">domain</span> Collateral Ops
                        </h3>
<div class="grid grid-cols-2 gap-4 mb-4">
<div class="p-3 bg-[#1c232d] border border-border-dark rounded-md">
<span class="block text-[10px] font-bold text-slate-500 uppercase">Occupancy</span>
<div class="flex items-baseline gap-2 mt-1">
<span class="text-xl font-mono font-bold text-white">72%</span>
<span class="text-[10px] text-status-red font-medium">▼ 5%</span>
</div>
</div>
<div class="p-3 bg-[#1c232d] border border-border-dark rounded-md">
<span class="block text-[10px] font-bold text-slate-500 uppercase">Collections</span>
<div class="flex items-baseline gap-2 mt-1">
<span class="text-xl font-mono font-bold text-white">$84k</span>
<span class="text-[10px] text-slate-400">/mo</span>
</div>
</div>
</div>
<div class="space-y-3">
<div class="flex justify-between items-center text-xs p-2 border border-border-dark rounded bg-[#111418]">
<span class="text-slate-400">Property Manager</span>
<span class="text-white font-medium">Cushman &amp; Wakefield</span>
</div>
<div class="flex justify-between items-center text-xs p-2 border border-border-dark rounded bg-[#111418]">
<span class="text-slate-400">Receiver Status</span>
<span class="text-status-amber font-medium">Motion Filed</span>
</div>
<div class="flex justify-between items-center text-xs p-2 border border-border-dark rounded bg-[#111418]">
<span class="text-slate-400">RE Taxes</span>
<span class="text-status-green font-medium">Paid thru Q3 '23</span>
</div>
<div class="flex justify-between items-center text-xs p-2 border border-border-dark rounded bg-[#111418]">
<span class="text-slate-400">Insurance</span>
<span class="text-white font-medium">Expires Dec 12, 2023</span>
</div>
</div>
</div>
</div>
<!-- Column 3: Comms & Audit (4 cols) -->
<div class="col-span-12 lg:col-span-4 flex flex-col gap-6">
<!-- Comms Module -->
<div class="bg-card-dark rounded-lg border border-border-dark p-5 shadow-sm min-h-[300px]">
<div class="flex items-center justify-between mb-4">
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
<span class="material-symbols-outlined text-sm">forum</span> Comms Log
                            </h3>
<button class="bg-primary/20 hover:bg-primary text-primary hover:text-white rounded p-1 transition-colors">
<span class="material-symbols-outlined text-sm block">add</span>
</button>
</div>
<div class="space-y-4">
<!-- Entry -->
<div class="relative pl-4 border-l-2 border-primary">
<div class="flex justify-between items-start">
<span class="text-xs font-bold text-white">Call with Borrower Counsel</span>
<span class="text-[10px] text-slate-500">2h ago</span>
</div>
<p class="text-xs text-slate-400 mt-1 leading-relaxed">Discussed forbearance terms. They are pushing for 12mo extension. I countered with 6mo + cash sweep.</p>
<div class="mt-2 flex gap-2">
<span class="text-[10px] bg-[#1c232d] text-slate-400 px-1.5 py-0.5 rounded border border-border-dark">Phone</span>
<span class="text-[10px] bg-[#1c232d] text-slate-400 px-1.5 py-0.5 rounded border border-border-dark">J. Smith</span>
</div>
</div>
<!-- Entry -->
<div class="relative pl-4 border-l-2 border-slate-700">
<div class="flex justify-between items-start">
<span class="text-xs font-bold text-white">Internal Strategy Sync</span>
<span class="text-[10px] text-slate-500">Yesterday</span>
</div>
<p class="text-xs text-slate-400 mt-1 leading-relaxed">Committee aligns on pursuing Deed-in-Lieu if borrower provides updated rent roll by Friday.</p>
</div>
</div>
<div class="mt-4 pt-4 border-t border-border-dark">
<div class="flex items-center gap-3 bg-[#136dec]/10 p-3 rounded border border-[#136dec]/30">
<span class="material-symbols-outlined text-primary">calendar_clock</span>
<div>
<span class="block text-[10px] font-bold text-primary uppercase">Next Scheduled Call</span>
<span class="text-xs text-white">Tomorrow, 2:00 PM EST</span>
</div>
</div>
</div>
</div>
<!-- Audit Timeline -->
<div class="bg-card-dark rounded-lg border border-border-dark p-5 shadow-sm flex-1">
<h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
<span class="material-symbols-outlined text-sm">history</span> Audit Timeline
                        </h3>
<div class="relative pl-2">
<!-- Spine -->
<div class="absolute left-1.5 top-2 bottom-2 w-px bg-border-dark"></div>
<div class="space-y-6">
<div class="relative pl-6">
<div class="absolute left-0 top-1 size-3 bg-[#111418] border-2 border-primary rounded-full z-10"></div>
<div class="text-xs text-white font-medium">Status changed to Enforcement</div>
<div class="text-[10px] text-slate-500">Sep 15, 09:30 AM • System</div>
</div>
<div class="relative pl-6">
<div class="absolute left-0 top-1 size-3 bg-[#111418] border-2 border-slate-600 rounded-full z-10"></div>
<div class="text-xs text-white font-medium">Appraisal Ordered</div>
<div class="text-[10px] text-slate-500">Sep 10, 02:15 PM • Sarah J.</div>
</div>
<div class="relative pl-6">
<div class="absolute left-0 top-1 size-3 bg-[#111418] border-2 border-slate-600 rounded-full z-10"></div>
<div class="text-xs text-white font-medium">Default Notice Sent</div>
<div class="text-[10px] text-slate-500">Sep 01, 11:00 AM • Legal Ops</div>
</div>
<div class="relative pl-6">
<div class="absolute left-0 top-1 size-3 bg-[#111418] border-2 border-slate-600 rounded-full z-10"></div>
<div class="text-xs text-white font-medium">Loan Transferred to Special Servicing</div>
<div class="text-[10px] text-slate-500">Aug 20, 04:45 PM • System</div>
</div>
</div>
</div>
</div>
</div>
</div>
</div>
</main>
<!-- Sticky Bottom Action Bar -->
<footer class="fixed bottom-0 left-0 w-full glass-panel z-50 px-6 py-4 shadow-2xl">
<div class="flex items-center justify-between max-w-[1600px] mx-auto">
<div class="flex items-center gap-3">
<label class="inline-flex items-center cursor-pointer">
<input class="sr-only peer" type="checkbox" value=""/>
<div class="relative w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
<span class="ms-3 text-xs font-medium text-slate-300 uppercase tracking-wide">Lock Snapshot</span>
</label>
<div class="h-4 w-px bg-border-dark mx-2"></div>
<span class="text-xs text-slate-500">Changes auto-saved 2m ago</span>
</div>
<div class="flex items-center gap-3">
<button class="px-4 py-2 rounded-lg border border-border-dark bg-[#1c232d] text-white text-sm font-bold hover:bg-[#2a3441] transition-colors flex items-center gap-2">
<span class="material-symbols-outlined text-[18px]">gavel</span>
                    Escalate to Committee
                </button>
<button class="px-4 py-2 rounded-lg border border-border-dark bg-[#1c232d] text-white text-sm font-bold hover:bg-[#2a3441] transition-colors flex items-center gap-2">
<span class="material-symbols-outlined text-[18px]">description</span>
                    Generate Term Sheet
                </button>
<button class="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary-dark transition-all shadow-glow flex items-center gap-2">
<span class="material-symbols-outlined text-[18px]">edit_document</span>
                    Draft Notice
                </button>
</div>
</div>
</footer>`;

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
