import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Loan Servicing Command Center";
const FONT_LINKS = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "background-light": "#f6f7f8",
                        "background-dark": "#0f1115", // Deep charcoal/black
                        "surface-dark": "#161b22",     // Panels
                        "border-dark": "#2d333b",      // Borders
                        "success": "#10b981",
                        "warning": "#f59e0b",
                        "danger": "#ef4444",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "mono": ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
                    },
                    fontSize: {
                        "xxs": "0.65rem",
                    }
                },
            },
        }`;
const STYLES = [
  "body {\n            font-family: 'Inter', sans-serif;\n        }\n        /* Custom Scrollbar for high density look */\n        ::-webkit-scrollbar {\n            width: 6px;\n            height: 6px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #0f1115; \n        }\n        ::-webkit-scrollbar-thumb {\n            background: #2d333b; \n            border-radius: 3px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #444c56; \n        }\n        .glass-panel {\n            background-color: rgba(22, 27, 34, 0.95);\n            backdrop-filter: blur(4px);\n            border: 1px solid #2d333b;\n        }\n        .chart-bar {\n            transition: height 0.5s ease;\n        }"
];
const BODY_HTML = `<!-- Global Header -->
<header class="h-14 shrink-0 flex items-center justify-between border-b border-border-dark px-6 bg-[#161b22]">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3 text-white">
<div class="size-6 text-primary">
<svg class="w-full h-full" fill="none" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<path clip-rule="evenodd" d="M24 0.757355L47.2426 24L24 47.2426L0.757355 24L24 0.757355ZM21 35.7574V12.2426L9.24264 24L21 35.7574Z" fill="currentColor" fill-rule="evenodd"></path>
</svg>
</div>
<h2 class="text-white text-lg font-bold tracking-tight">Buddy</h2>
</div>
<nav class="flex items-center gap-6">
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Deals</a>
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Intake</a>
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Portfolio</a>
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Committee</a>
<a class="text-slate-400 hover:text-white text-sm font-medium transition-colors" href="#">Reporting</a>
<a class="text-white bg-primary/10 px-3 py-1 rounded-full text-sm font-semibold border border-primary/20" href="#">Servicing</a>
</nav>
</div>
<div class="flex items-center gap-6">
<div class="relative w-80 h-9">
<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
<span class="material-symbols-outlined text-[20px]">search</span>
</div>
<input class="block w-full h-full pl-10 pr-3 py-2 border border-border-dark rounded-md leading-5 bg-[#0d1117] text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary sm:text-sm" placeholder="Search loans, borrowers, collateral (Cmd+K)" type="text"/>
<div class="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
<span class="text-slate-600 text-xs border border-slate-700 rounded px-1.5 py-0.5">/</span>
</div>
</div>
<button class="relative text-slate-400 hover:text-white">
<span class="material-symbols-outlined">notifications</span>
<span class="absolute top-0 right-0 block h-2 w-2 rounded-full bg-danger ring-2 ring-[#161b22]"></span>
</button>
<div class="bg-center bg-no-repeat bg-cover rounded-full size-8 border border-slate-600" data-alt="User Avatar" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuDxtWEjOfK_0xTYfwZYDSiVDVgJGBix1PgV-iin2lzeP9Hifzxv2td_T3U_2gXde87A6tIR93H1GFZZ9rTsFWrWpiwGMLKLdHvu16hWBRxrU73QpgIud4OyW70BBoyxQOXVW3bk8MtZKTkJmun6sG_vU2SsXfMCy6ENuFjq1VPmF1I2y1folYPT-tnYVLhy3PIHItgYE6vhkg5H7chJ-2Zs6AhoROL0fSFvyR7_B-Qnf9nUA6WY-jnZPsw1or06UhNpeV8uJOFe3bU");'></div>
</div>
</header>
<!-- Main Content Grid -->
<main class="flex-1 grid grid-cols-12 gap-0 overflow-hidden bg-[#0f1115]">
<!-- Column 1: Identity & Action Queue (3 cols) -->
<div class="col-span-3 border-r border-border-dark flex flex-col overflow-y-auto">
<!-- Sticky Loan Header -->
<div class="p-4 border-b border-border-dark bg-[#161b22] sticky top-0 z-10 shadow-lg shadow-black/20">
<div class="flex gap-4 mb-4">
<div class="bg-center bg-no-repeat bg-cover rounded-md w-24 h-24 shrink-0 border border-slate-700" data-alt="Building exterior of Highland Retail Village" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuBYVdj-7Z3t4ELNKcxUYnSuu0HzvoenczJ1RTNDlorz2ZfEoGqxqc_Htuf0jY6zYC6UEsXFhXLe-bepb9_P45nW-wGUm5lbbDLZZqWFmlsrt0XFgzJ6bEer6asmXPG0Y8OVue7OLn24_oye2yU1SGJBa3y9vW7b-4m1jEuLac6-4R_u02OwC4mjiFXRnclgXvVpR-WsRDLiXeOBk_4G9FZRZCxKyqK81-xwjO_vyUxSaIPC30Rq3whBdDJZX7CYvBc4U92z2zqVuus");'></div>
<div class="flex flex-col justify-between py-0.5">
<div>
<h1 class="text-white text-lg font-bold leading-tight">Highland Retail Village</h1>
<p class="text-slate-400 text-xs font-mono mt-1">LN-2023-849</p>
<p class="text-slate-400 text-xs mt-0.5">Highland Capital Partners LLC</p>
</div>
<div class="text-xs text-slate-500 flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]">location_on</span>
                            1200 Highland Ave, Austin, TX
                        </div>
</div>
</div>
<!-- Status Chips -->
<div class="flex flex-wrap gap-2 mb-4">
<div class="flex items-center gap-1.5 px-2 py-1 rounded bg-warning/10 border border-warning/20">
<span class="material-symbols-outlined text-warning text-[16px]">warning</span>
<span class="text-warning text-xs font-bold tracking-wide">WATCHLIST</span>
</div>
<div class="flex items-center gap-1.5 px-2 py-1 rounded bg-primary/10 border border-primary/20">
<span class="material-symbols-outlined text-primary text-[16px]">hourglass_top</span>
<span class="text-primary text-xs font-medium">IO Period: 74 Days Left</span>
</div>
</div>
<!-- Critical Alert -->
<div class="bg-[#1c2128] rounded-md border border-slate-700 p-3 flex items-center justify-between">
<div>
<p class="text-xs text-slate-400 uppercase tracking-wider font-semibold">Next Key Event</p>
<p class="text-white text-sm font-bold mt-1">Rate Reset</p>
</div>
<div class="flex items-baseline gap-1 bg-[#0d1117] px-3 py-1.5 rounded border border-slate-800">
<span class="text-xl font-bold text-white tabular-nums">12</span>
<span class="text-xs text-slate-500">Days</span>
</div>
</div>
</div>
<!-- Action Queue -->
<div class="flex-1 p-4 bg-[#0f1115]">
<div class="flex items-center justify-between mb-3">
<h3 class="text-slate-200 text-sm font-bold uppercase tracking-wide">Servicing Queue</h3>
<span class="bg-slate-800 text-slate-400 text-xs px-1.5 py-0.5 rounded-full">6</span>
</div>
<div class="space-y-2">
<!-- Item 1 -->
<div class="group p-3 rounded bg-[#161b22] border-l-2 border-l-danger border border-t-[#2d333b] border-r-[#2d333b] border-b-[#2d333b] hover:border-primary/50 transition-colors">
<div class="flex justify-between items-start mb-2">
<span class="text-white text-sm font-medium">Rate Reset Review</span>
<span class="text-[10px] px-1.5 py-0.5 bg-danger/10 text-danger rounded border border-danger/20 font-bold">URGENT</span>
</div>
<div class="flex justify-between items-end">
<div class="text-xs text-slate-500">
<p>Owner: J. Doe</p>
<p>Due: <span class="text-slate-300">Today</span></p>
</div>
<button class="text-xs bg-slate-800 hover:bg-primary text-white px-3 py-1 rounded transition-colors">Open</button>
</div>
</div>
<!-- Item 2 -->
<div class="group p-3 rounded bg-[#161b22] border-l-2 border-l-warning border border-t-[#2d333b] border-r-[#2d333b] border-b-[#2d333b] hover:border-primary/50 transition-colors">
<div class="flex justify-between items-start mb-2">
<span class="text-white text-sm font-medium">DSCR Test Trigger</span>
<span class="text-[10px] px-1.5 py-0.5 bg-warning/10 text-warning rounded border border-warning/20 font-bold">HIGH</span>
</div>
<div class="flex justify-between items-end">
<div class="text-xs text-slate-500">
<p>Owner: System</p>
<p>Due: <span class="text-slate-300">Tomorrow</span></p>
</div>
<button class="text-xs bg-slate-800 hover:bg-primary text-white px-3 py-1 rounded transition-colors">Open</button>
</div>
</div>
<!-- Item 3 -->
<div class="group p-3 rounded bg-[#161b22] border-l-2 border-l-primary border border-t-[#2d333b] border-r-[#2d333b] border-b-[#2d333b] hover:border-primary/50 transition-colors">
<div class="flex justify-between items-start mb-2">
<span class="text-white text-sm font-medium">Borrower Financials</span>
<span class="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded border border-primary/20 font-bold">MED</span>
</div>
<div class="flex justify-between items-end">
<div class="text-xs text-slate-500">
<p>Owner: A. Smith</p>
<p>Due: <span class="text-slate-300">In 3 days</span></p>
</div>
<button class="text-xs bg-slate-800 hover:bg-primary text-white px-3 py-1 rounded transition-colors">Open</button>
</div>
</div>
<!-- Item 4 -->
<div class="group p-3 rounded bg-[#161b22] border-l-2 border-l-slate-600 border border-t-[#2d333b] border-r-[#2d333b] border-b-[#2d333b] hover:border-primary/50 transition-colors opacity-75">
<div class="flex justify-between items-start mb-2">
<span class="text-white text-sm font-medium">Insurance Renewal</span>
</div>
<div class="flex justify-between items-end">
<div class="text-xs text-slate-500">
<p>Owner: Ops Team</p>
<p>Due: <span class="text-slate-300">Oct 14</span></p>
</div>
<button class="text-xs bg-slate-800 hover:bg-primary text-white px-3 py-1 rounded transition-colors">Open</button>
</div>
</div>
</div>
</div>
<!-- Quick Controls -->
<div class="p-4 mt-auto border-t border-border-dark bg-[#161b22]">
<h3 class="text-slate-400 text-xs font-bold uppercase tracking-wide mb-3">Quick Controls</h3>
<div class="grid grid-cols-2 gap-2">
<button class="flex items-center justify-center gap-2 p-2 bg-[#0d1117] border border-slate-700 rounded hover:bg-slate-800 text-xs font-medium text-slate-300 transition-colors">
<span class="material-symbols-outlined text-[16px]">description</span> Request Docs
                    </button>
<button class="flex items-center justify-center gap-2 p-2 bg-[#0d1117] border border-slate-700 rounded hover:bg-slate-800 text-xs font-medium text-slate-300 transition-colors">
<span class="material-symbols-outlined text-[16px]">send</span> Send Notice
                    </button>
<button class="flex items-center justify-center gap-2 p-2 bg-[#0d1117] border border-slate-700 rounded hover:bg-slate-800 text-xs font-medium text-slate-300 transition-colors">
<span class="material-symbols-outlined text-[16px]">check_circle</span> Approve Waiver
                    </button>
<button class="flex items-center justify-center gap-2 p-2 bg-[#0d1117] border border-slate-700 rounded hover:bg-slate-800 text-xs font-medium text-slate-300 transition-colors">
<span class="material-symbols-outlined text-[16px]">warning</span> Escalate
                    </button>
</div>
</div>
</div>
<!-- Column 2: Performance Truth (6 cols) -->
<div class="col-span-6 border-r border-border-dark flex flex-col overflow-y-auto bg-[#0f1115] scrollbar-thin">
<!-- KPI Strip -->
<div class="grid grid-cols-3 gap-px bg-border-dark border-b border-border-dark">
<div class="bg-[#161b22] p-4 group hover:bg-[#1c2128] transition-colors relative">
<p class="text-xs text-slate-400 font-medium">Current NOI (TTM)</p>
<div class="flex items-baseline gap-2 mt-1">
<p class="text-xl font-bold text-white font-mono">$3.82M</p>
<span class="text-xs text-danger flex items-center">
<span class="material-symbols-outlined text-[14px]">arrow_downward</span> 6.2%
                        </span>
</div>
<div class="w-full h-1 bg-slate-800 mt-2 rounded-full overflow-hidden">
<div class="h-full bg-danger w-[92%]"></div>
</div>
</div>
<div class="bg-[#161b22] p-4 group hover:bg-[#1c2128] transition-colors relative">
<p class="text-xs text-slate-400 font-medium">DSCR (TTM)</p>
<div class="flex items-baseline gap-2 mt-1">
<p class="text-xl font-bold text-warning font-mono">1.15x</p>
<span class="text-xs text-slate-500 font-mono">Min: 1.20x</span>
</div>
<div class="w-full h-1 bg-slate-800 mt-2 rounded-full overflow-hidden relative">
<!-- Threshold marker -->
<div class="absolute left-[80%] top-0 bottom-0 w-0.5 bg-white z-10"></div>
<div class="h-full bg-warning w-[75%]"></div>
</div>
</div>
<div class="bg-[#161b22] p-4 group hover:bg-[#1c2128] transition-colors">
<p class="text-xs text-slate-400 font-medium">Debt Yield</p>
<div class="flex items-baseline gap-2 mt-1">
<p class="text-xl font-bold text-white font-mono">8.4%</p>
<span class="text-xs text-success flex items-center">
<span class="material-symbols-outlined text-[14px]">remove</span> 0.0%
                        </span>
</div>
<div class="w-full h-1 bg-slate-800 mt-2 rounded-full overflow-hidden">
<div class="h-full bg-primary w-[84%]"></div>
</div>
</div>
<div class="bg-[#161b22] p-4 group hover:bg-[#1c2128] transition-colors">
<p class="text-xs text-slate-400 font-medium">Occupancy</p>
<div class="flex items-baseline gap-2 mt-1">
<p class="text-xl font-bold text-white font-mono">92.5%</p>
<span class="text-xs text-danger flex items-center">
<span class="material-symbols-outlined text-[14px]">arrow_downward</span> 2.1%
                        </span>
</div>
</div>
<div class="bg-[#161b22] p-4 group hover:bg-[#1c2128] transition-colors">
<p class="text-xs text-slate-400 font-medium">Reserve Balance</p>
<div class="flex items-baseline gap-2 mt-1">
<p class="text-xl font-bold text-white font-mono">$1.24M</p>
<span class="text-xs text-slate-500">Stable</span>
</div>
</div>
<div class="bg-[#161b22] p-4 group hover:bg-[#1c2128] transition-colors">
<p class="text-xs text-slate-400 font-medium">Risk Score</p>
<div class="flex items-baseline gap-2 mt-1">
<p class="text-xl font-bold text-warning font-mono">7/10</p>
<span class="text-xs text-slate-500">Elevated</span>
</div>
</div>
</div>
<!-- Cash Flow Trend -->
<div class="p-6 border-b border-border-dark bg-[#0f1115]">
<div class="flex items-center justify-between mb-6">
<div>
<h3 class="text-white text-base font-bold">Cash Flow Trends</h3>
<p class="text-slate-500 text-xs mt-0.5">Last 12 Months: Actual vs Underwritten</p>
</div>
<div class="flex gap-4 text-xs">
<div class="flex items-center gap-2">
<span class="w-3 h-3 rounded-sm bg-slate-600"></span> <span class="text-slate-400">Underwritten</span>
</div>
<div class="flex items-center gap-2">
<span class="w-3 h-3 rounded-sm bg-primary"></span> <span class="text-slate-400">Actual</span>
</div>
<a class="text-primary hover:text-primary/80 flex items-center gap-1 font-medium" href="#">
                             View Source <span class="material-symbols-outlined text-[14px]">open_in_new</span>
</a>
</div>
</div>
<!-- Mock Chart Area -->
<div class="h-48 w-full flex items-end justify-between gap-2 px-2 pb-2 border-b border-l border-slate-800 relative">
<!-- Horizontal Grid lines -->
<div class="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
<div class="w-full border-t border-slate-500"></div>
<div class="w-full border-t border-slate-500"></div>
<div class="w-full border-t border-slate-500"></div>
<div class="w-full border-t border-slate-500"></div>
<div class="w-full border-t border-slate-500"></div>
</div>
<!-- Bars -->
<!-- Month 1 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[60%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[95%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div><div class="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded shadow border border-slate-700 whitespace-nowrap z-10">$320k</div></div>
<!-- Month 2 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[62%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[92%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 3 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[65%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[88%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 4 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[64%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[85%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 5 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[68%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[82%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 6 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[70%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[75%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 7 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[72%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[70%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 8 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[71%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[65%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 9 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[73%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[60%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 10 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[75%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[58%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 11 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[76%] relative group"><div class="absolute bottom-0 inset-x-1 bg-primary h-[55%] rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity"></div></div>
<!-- Month 12 --> <div class="w-full bg-slate-800/50 rounded-t-sm h-[78%] relative group"><div class="absolute bottom-0 inset-x-1 bg-danger h-[52%] rounded-t-sm opacity-90 group-hover:opacity-100 transition-opacity"></div><div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/50 text-xs">!</div></div>
</div>
<div class="flex justify-between text-[10px] text-slate-500 mt-2 font-mono uppercase">
<span>Oct</span><span>Nov</span><span>Dec</span><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span>
</div>
</div>
<!-- Covenant Compliance -->
<div class="p-6">
<div class="flex items-center justify-between mb-4">
<h3 class="text-white text-base font-bold">Covenant Compliance</h3>
<span class="text-xs text-slate-500">Last Tested: Oct 01, 2023</span>
</div>
<div class="rounded-md border border-slate-800 overflow-hidden">
<table class="w-full text-left text-sm">
<thead class="bg-[#161b22] text-xs uppercase text-slate-400 font-semibold border-b border-slate-800">
<tr>
<th class="px-4 py-3">Covenant</th>
<th class="px-4 py-3 text-right">Current</th>
<th class="px-4 py-3 text-right">Threshold</th>
<th class="px-4 py-3 text-center">Status</th>
<th class="px-4 py-3 text-right">Action</th>
</tr>
</thead>
<tbody class="divide-y divide-slate-800 bg-[#0d1117]">
<!-- DSCR -->
<tr class="group hover:bg-[#161b22] transition-colors">
<td class="px-4 py-3 text-slate-200 font-medium">Debt Service Coverage Ratio</td>
<td class="px-4 py-3 text-right font-mono text-warning font-bold">1.15x</td>
<td class="px-4 py-3 text-right font-mono text-slate-400">Min 1.20x</td>
<td class="px-4 py-3 text-center">
<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-danger/10 text-danger border border-danger/20">FAIL</span>
</td>
<td class="px-4 py-3 text-right">
<a class="text-primary hover:underline text-xs" href="#">Evidence</a>
</td>
</tr>
<!-- LTV -->
<tr class="group hover:bg-[#161b22] transition-colors">
<td class="px-4 py-3 text-slate-200 font-medium">Loan to Value (LTV)</td>
<td class="px-4 py-3 text-right font-mono text-slate-200">62.4%</td>
<td class="px-4 py-3 text-right font-mono text-slate-400">Max 70.0%</td>
<td class="px-4 py-3 text-center">
<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-success/10 text-success border border-success/20">PASS</span>
</td>
<td class="px-4 py-3 text-right">
<a class="text-primary hover:underline text-xs" href="#">Evidence</a>
</td>
</tr>
<!-- Liquidity -->
<tr class="group hover:bg-[#161b22] transition-colors">
<td class="px-4 py-3 text-slate-200 font-medium">Borrower Liquidity</td>
<td class="px-4 py-3 text-right font-mono text-slate-200">$5.2M</td>
<td class="px-4 py-3 text-right font-mono text-slate-400">Min $2.0M</td>
<td class="px-4 py-3 text-center">
<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-success/10 text-success border border-success/20">PASS</span>
</td>
<td class="px-4 py-3 text-right">
<a class="text-primary hover:underline text-xs" href="#">Evidence</a>
</td>
</tr>
<!-- Reporting -->
<tr class="group hover:bg-[#161b22] transition-colors">
<td class="px-4 py-3 text-slate-200 font-medium">Financial Reporting (Q3)</td>
<td class="px-4 py-3 text-right font-mono text-slate-200">-</td>
<td class="px-4 py-3 text-right font-mono text-slate-400">45 Days</td>
<td class="px-4 py-3 text-center">
<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-warning/10 text-warning border border-warning/20">PENDING</span>
</td>
<td class="px-4 py-3 text-right">
<a class="text-primary hover:underline text-xs" href="#">Upload</a>
</td>
</tr>
</tbody>
</table>
</div>
</div>
<!-- Payment History Compact -->
<div class="mx-6 p-4 mb-6 bg-[#161b22] rounded-md border border-slate-800 flex items-center justify-between">
<div class="flex gap-8">
<div>
<p class="text-xs text-slate-500 uppercase font-semibold">Last Payment</p>
<p class="text-white text-sm font-mono mt-1">$245,102 <span class="text-success text-xs ml-1">(Paid)</span></p>
<p class="text-xs text-slate-600 mt-0.5">Sep 01, 2023</p>
</div>
<div>
<p class="text-xs text-slate-500 uppercase font-semibold">Next Payment</p>
<p class="text-white text-sm font-mono mt-1">$258,400 <span class="text-primary text-xs ml-1">(Auto)</span></p>
<p class="text-xs text-slate-600 mt-0.5">Oct 01, 2023</p>
</div>
</div>
<div class="flex items-center gap-2">
<div class="text-right mr-2">
<p class="text-xs text-slate-400">Payment Health</p>
<p class="text-[10px] text-slate-600">Last 6 Months</p>
</div>
<!-- Status dots -->
<div class="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center border border-success/30"><span class="material-symbols-outlined text-[16px] text-success">check</span></div>
<div class="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center border border-success/30"><span class="material-symbols-outlined text-[16px] text-success">check</span></div>
<div class="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center border border-warning/30" title="Late (Grace Period)"><span class="material-symbols-outlined text-[16px] text-warning">schedule</span></div>
<div class="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center border border-success/30"><span class="material-symbols-outlined text-[16px] text-success">check</span></div>
<div class="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center border border-success/30"><span class="material-symbols-outlined text-[16px] text-success">check</span></div>
<div class="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center border border-success/30"><span class="material-symbols-outlined text-[16px] text-success">check</span></div>
</div>
</div>
</div>
<!-- Column 3: Rate Control & Audit (3 cols) -->
<div class="col-span-3 flex flex-col bg-[#0f1115] overflow-y-auto">
<!-- Rate Engine -->
<div class="p-5 border-b border-border-dark bg-[#161b22]">
<div class="flex items-center gap-2 mb-4">
<span class="material-symbols-outlined text-primary">percent</span>
<h3 class="text-white text-sm font-bold uppercase tracking-wide">Rate &amp; Reset Control</h3>
</div>
<div class="bg-[#0d1117] rounded-lg p-4 border border-slate-700 mb-4">
<div class="flex justify-between items-baseline mb-1">
<span class="text-slate-400 text-xs">Current All-in Rate</span>
<span class="text-2xl font-bold text-white font-mono tracking-tight">8.07%</span>
</div>
<div class="flex justify-between items-center text-xs text-slate-500 font-mono mb-4 pb-4 border-b border-slate-800">
<span>SOFR (5.32%) + 275 bps</span>
<span class="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">Floating</span>
</div>
<div class="space-y-3">
<div class="flex justify-between items-center">
<span class="text-slate-400 text-xs">Next Reset Date</span>
<span class="text-white text-sm font-medium">Oct 12, 2023</span>
</div>
<div class="flex justify-between items-center">
<span class="text-slate-400 text-xs">Reset Preview (+50bps)</span>
<span class="text-warning text-sm font-mono font-bold">8.57%</span>
</div>
</div>
<div class="grid grid-cols-2 gap-2 mt-5">
<button class="bg-[#1c2128] border border-slate-600 hover:bg-slate-700 text-slate-300 text-xs py-2 rounded font-medium transition-colors">Simulate</button>
<button class="bg-primary hover:bg-primary/90 text-white text-xs py-2 rounded font-medium transition-colors shadow-lg shadow-primary/20">Confirm Reset</button>
</div>
</div>
<div class="flex justify-between px-1">
<div class="text-center">
<p class="text-[10px] text-slate-500 uppercase">Floor</p>
<p class="text-slate-300 text-xs font-mono">4.50%</p>
</div>
<div class="text-center border-l border-slate-700 pl-4">
<p class="text-[10px] text-slate-500 uppercase">Cap</p>
<p class="text-slate-300 text-xs font-mono">9.50%</p>
</div>
<div class="text-center border-l border-slate-700 pl-4">
<p class="text-[10px] text-slate-500 uppercase">Spread</p>
<p class="text-slate-300 text-xs font-mono">2.75%</p>
</div>
</div>
</div>
<!-- Exceptions -->
<div class="p-5 border-b border-border-dark">
<h3 class="text-slate-400 text-xs font-bold uppercase tracking-wide mb-3">Material Changes</h3>
<div class="space-y-3">
<div class="flex gap-3 items-start">
<span class="material-symbols-outlined text-danger text-[18px] mt-0.5">trending_down</span>
<div>
<p class="text-white text-xs font-medium leading-tight">NOI decreased by 6.2% YoY</p>
<p class="text-slate-500 text-[10px] mt-0.5">Source: Q3 T-12 Statement</p>
</div>
<a class="ml-auto text-primary text-[10px] uppercase font-bold mt-0.5" href="#">Review</a>
</div>
<div class="flex gap-3 items-start">
<span class="material-symbols-outlined text-warning text-[18px] mt-0.5">gavel</span>
<div>
<p class="text-white text-xs font-medium leading-tight">DSCR Breach Triggered</p>
<p class="text-slate-500 text-[10px] mt-0.5">Covenant 4.2(a)</p>
</div>
<a class="ml-auto text-primary text-[10px] uppercase font-bold mt-0.5" href="#">Review</a>
</div>
<div class="flex gap-3 items-start">
<span class="material-symbols-outlined text-slate-400 text-[18px] mt-0.5">history_edu</span>
<div>
<p class="text-white text-xs font-medium leading-tight">Insurance Expiring Soon</p>
<p class="text-slate-500 text-[10px] mt-0.5">Policy #449-22 expires in 14d</p>
</div>
</div>
</div>
</div>
<!-- Immutable Audit Trail -->
<div class="flex-1 p-5 bg-[#0f1115]">
<div class="flex items-center justify-between mb-4">
<h3 class="text-slate-400 text-xs font-bold uppercase tracking-wide">Audit Trail</h3>
<button class="text-[10px] text-primary hover:text-white flex items-center gap-1"><span class="material-symbols-outlined text-[12px]">download</span> Export</button>
</div>
<div class="relative pl-2 border-l border-slate-800 space-y-6">
<!-- Event 1 -->
<div class="relative pl-4">
<div class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-[#0f1115]"></div>
<p class="text-[10px] text-slate-500 font-mono mb-0.5">Today, 09:41 AM</p>
<p class="text-slate-200 text-xs">Rate Reset Calculation Triggered</p>
<div class="flex items-center gap-1 mt-1">
<span class="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[8px] text-white">S</span>
<span class="text-[10px] text-slate-500">System</span>
</div>
</div>
<!-- Event 2 -->
<div class="relative pl-4">
<div class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-600 border-2 border-[#0f1115]"></div>
<p class="text-[10px] text-slate-500 font-mono mb-0.5">Yesterday, 4:20 PM</p>
<p class="text-slate-200 text-xs">Borrower Uploaded T-12 Stmt</p>
<div class="flex items-center gap-1 mt-1">
<span class="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center text-[8px] text-white">B</span>
<span class="text-[10px] text-slate-500">Borrower Portal</span>
</div>
</div>
<!-- Event 3 -->
<div class="relative pl-4">
<div class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-600 border-2 border-[#0f1115]"></div>
<p class="text-[10px] text-slate-500 font-mono mb-0.5">Sep 28, 11:05 AM</p>
<p class="text-slate-200 text-xs">Covenant Test Executed: <span class="text-danger">FAIL</span></p>
<div class="flex items-center gap-1 mt-1">
<span class="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[8px] text-white">S</span>
<span class="text-[10px] text-slate-500">System Auto-Run</span>
</div>
</div>
<!-- Event 4 -->
<div class="relative pl-4">
<div class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-600 border-2 border-[#0f1115]"></div>
<p class="text-[10px] text-slate-500 font-mono mb-0.5">Sep 25, 02:15 PM</p>
<p class="text-slate-200 text-xs">Waiver Request Approved</p>
<div class="flex items-center gap-1 mt-1">
<div class="w-4 h-4 rounded-full bg-cover" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuBANmBW-6YGvdghaUwV4B0imju-vRtJXDpuIjzkz4AAzXSwlBkYgA-qOtdgh3HlscyVrKeMkS0EgZsCY6A7EDrsL8E1VaX-C9rkzTLXdl2KN3y0tQO7y1f47no4p_U1oFIg7UGm5OzEcDVpLVi3fGJjkrZXqD54Mggf4mAIFhggwngR95oyni05YSTjNvaqwMXU2W9JdnNOlyhDpfATWSjL-qU_L562ks8xvGGgMayqV34WKcSOJ9E06zZwWvd9LaADFBZmM78z9QE");'></div>
<span class="text-[10px] text-slate-500">B. Underwriter</span>
</div>
</div>
</div>
</div>
<!-- Sticky Bottom Actions for col-3 -->
<div class="p-4 bg-[#161b22] border-t border-border-dark mt-auto sticky bottom-0 z-20">
<button class="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2 px-4 rounded text-sm mb-2 shadow-lg shadow-primary/20 transition-colors flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-[18px]">save</span> Save Snapshot
                </button>
<div class="grid grid-cols-2 gap-2">
<button class="bg-[#0d1117] border border-slate-700 hover:bg-slate-700 text-slate-300 py-2 rounded text-xs font-medium transition-colors">
                        PDF Memo
                    </button>
<button class="bg-[#0d1117] border border-slate-700 hover:bg-slate-700 text-slate-300 py-2 rounded text-xs font-medium transition-colors">
                        Lock &amp; Export
                    </button>
</div>
</div>
</div>
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
