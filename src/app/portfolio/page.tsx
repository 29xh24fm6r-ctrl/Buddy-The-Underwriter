import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Buddy the Underwriter - Portfolio Command Bridge";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "background-light": "#f6f7f8",
                        "background-dark": "#111418",
                        "surface-dark": "#1c2128",
                        "surface-darker": "#161b22",
                        "border-dark": "#2d333b",
                        "text-secondary": "#9da8b9",
                        "success": "#2da44e",
                        "warning": "#d29922",
                        "danger": "#cf222e",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "body": ["Inter", "sans-serif"],
                    },
                    fontSize: {
                        "xxs": "0.65rem",
                    }
                },
            },
        }`;
const STYLES = [
  "body { font-family: 'Inter', sans-serif; }\n        /* Custom scrollbar for dense data tables */\n        ::-webkit-scrollbar {\n            width: 8px;\n            height: 8px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #111418; \n        }\n        ::-webkit-scrollbar-thumb {\n            background: #2d333b; \n            border-radius: 4px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #444c56; \n        }\n        .no-scrollbar::-webkit-scrollbar {\n            display: none;\n        }\n        .no-scrollbar {\n            -ms-overflow-style: none;  /* IE and Edge */\n            scrollbar-width: none;  /* Firefox */\n        }"
];
const BODY_HTML = `<!-- Top Navigation -->
<header class="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-solid border-border-dark bg-surface-darker px-6 py-3 z-50">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3 text-white">
<div class="size-6 text-primary">
<svg fill="none" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<path d="M24 45.8096C19.6865 45.8096 15.4698 44.5305 11.8832 42.134C8.29667 39.7376 5.50128 36.3314 3.85056 32.3462C2.19985 28.361 1.76794 23.9758 2.60947 19.7452C3.451 15.5145 5.52816 11.6284 8.57829 8.5783C11.6284 5.52817 15.5145 3.45101 19.7452 2.60948C23.9758 1.76795 28.361 2.19986 32.3462 3.85057C36.3314 5.50129 39.7376 8.29668 42.134 11.8833C44.5305 15.4698 45.8096 19.6865 45.8096 24L24 24L24 45.8096Z" fill="currentColor"></path>
</svg>
</div>
<h2 class="text-white text-base font-bold leading-tight tracking-tight">Buddy the Underwriter</h2>
</div>
<nav class="flex items-center gap-1 bg-surface-dark rounded-lg p-1 border border-border-dark">
<a class="px-4 py-1.5 text-sm font-medium text-text-secondary hover:text-white rounded-md transition-colors" href="#">Deals</a>
<a class="px-4 py-1.5 text-sm font-bold text-white bg-primary/20 rounded-md shadow-sm border border-primary/30" href="#">Portfolio</a>
<a class="px-4 py-1.5 text-sm font-medium text-text-secondary hover:text-white rounded-md transition-colors" href="#">Committee</a>
<a class="px-4 py-1.5 text-sm font-medium text-text-secondary hover:text-white rounded-md transition-colors" href="#">Reporting</a>
</nav>
</div>
<div class="flex flex-1 justify-center max-w-xl mx-8">
<label class="flex w-full items-center gap-2 rounded-lg bg-surface-dark border border-border-dark px-3 py-2 focus-within:border-primary/50 transition-colors">
<span class="material-symbols-outlined text-text-secondary text-[20px]">search</span>
<input class="w-full bg-transparent text-sm text-white placeholder:text-text-secondary focus:outline-none" placeholder="Search loans, borrowers, collateral..."/>
<div class="flex gap-1">
<span class="text-xs text-text-secondary border border-border-dark rounded px-1.5 py-0.5">⌘ K</span>
</div>
</label>
</div>
<div class="flex items-center gap-4">
<div class="flex gap-2">
<button class="flex items-center justify-center size-9 rounded-lg hover:bg-surface-dark text-text-secondary hover:text-white transition-colors relative">
<span class="material-symbols-outlined text-[20px]">notifications</span>
<span class="absolute top-2 right-2 size-2 bg-danger rounded-full border border-surface-darker"></span>
</button>
<button class="flex items-center justify-center size-9 rounded-lg hover:bg-surface-dark text-text-secondary hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">help</span>
</button>
</div>
<div class="h-6 w-px bg-border-dark"></div>
<button class="flex items-center gap-3 pl-1 pr-2 py-1 rounded-full hover:bg-surface-dark transition-colors border border-transparent hover:border-border-dark group">
<div class="size-8 rounded-full bg-gradient-to-tr from-primary to-purple-500 flex items-center justify-center text-xs font-bold text-white border border-white/10" data-alt="User Avatar Gradient">JD</div>
<div class="flex flex-col items-start">
<span class="text-xs font-semibold text-white group-hover:text-primary transition-colors">J. Doe</span>
<span class="text-[10px] text-text-secondary">Portfolio Mgr</span>
</div>
</button>
</div>
</header>
<!-- Main Content Area -->
<main class="flex flex-1 overflow-hidden">
<div class="flex flex-col flex-1 min-w-0">
<!-- KPI Strip -->
<section class="shrink-0 bg-surface-darker border-b border-border-dark px-6 py-4 overflow-x-auto no-scrollbar">
<div class="flex gap-4 min-w-max">
<!-- KPI Card 1 -->
<div class="flex flex-col gap-1 min-w-[140px]">
<span class="text-text-secondary text-xs font-medium uppercase tracking-wider">Total Exposure</span>
<div class="flex items-baseline gap-2">
<span class="text-white text-xl font-bold font-mono tracking-tight">$845.2M</span>
<span class="text-success text-xs font-medium bg-success/10 px-1 rounded flex items-center">
<span class="material-symbols-outlined text-[12px] mr-0.5">trending_up</span>2.1%
                            </span>
</div>
</div>
<div class="w-px bg-border-dark h-10 self-center"></div>
<!-- KPI Card 2 -->
<div class="flex flex-col gap-1 min-w-[140px]">
<span class="text-text-secondary text-xs font-medium uppercase tracking-wider">Ann. Profit</span>
<div class="flex items-baseline gap-2">
<span class="text-white text-xl font-bold font-mono tracking-tight">$42.5M</span>
<span class="text-success text-xs font-medium bg-success/10 px-1 rounded flex items-center">
<span class="material-symbols-outlined text-[12px] mr-0.5">trending_up</span>1.5%
                            </span>
</div>
</div>
<div class="w-px bg-border-dark h-10 self-center"></div>
<!-- KPI Card 3 -->
<div class="flex flex-col gap-1 min-w-[140px]">
<span class="text-text-secondary text-xs font-medium uppercase tracking-wider">WA Coupon</span>
<div class="flex items-baseline gap-2">
<span class="text-white text-xl font-bold font-mono tracking-tight">6.85%</span>
<span class="text-danger text-xs font-medium bg-danger/10 px-1 rounded flex items-center">
<span class="material-symbols-outlined text-[12px] mr-0.5">trending_down</span>-5bp
                            </span>
</div>
</div>
<div class="w-px bg-border-dark h-10 self-center"></div>
<!-- KPI Card 4 -->
<div class="flex flex-col gap-1 min-w-[140px]">
<span class="text-text-secondary text-xs font-medium uppercase tracking-wider">% Variable</span>
<div class="flex items-baseline gap-2">
<span class="text-white text-xl font-bold font-mono tracking-tight">42%</span>
<span class="text-text-secondary text-xs font-medium px-1">Flat</span>
</div>
</div>
<div class="w-px bg-border-dark h-10 self-center"></div>
<!-- KPI Card 5 - Alert -->
<div class="flex flex-col gap-1 min-w-[120px]">
<span class="text-text-secondary text-xs font-medium uppercase tracking-wider">Watchlist</span>
<div class="flex items-baseline gap-2">
<span class="text-warning text-xl font-bold font-mono tracking-tight">4</span>
<span class="text-warning text-xs font-medium bg-warning/10 px-1 rounded">+1 New</span>
</div>
</div>
<div class="w-px bg-border-dark h-10 self-center"></div>
<!-- KPI Card 6 - Alert -->
<div class="flex flex-col gap-1 min-w-[120px]">
<span class="text-text-secondary text-xs font-medium uppercase tracking-wider">Near Breach</span>
<div class="flex items-baseline gap-2">
<span class="text-danger text-xl font-bold font-mono tracking-tight">2</span>
<span class="text-text-secondary text-xs font-medium">Unchanged</span>
</div>
</div>
<div class="w-px bg-border-dark h-10 self-center"></div>
<!-- KPI Card 7 -->
<div class="flex flex-col gap-1 min-w-[120px]">
<span class="text-text-secondary text-xs font-medium uppercase tracking-wider">IO Loans</span>
<div class="flex items-baseline gap-2">
<span class="text-white text-xl font-bold font-mono tracking-tight">15</span>
<span class="text-success text-xs font-medium bg-success/10 px-1 rounded">-2</span>
</div>
</div>
<!-- KPI Card 8 -->
<div class="flex flex-col gap-1 min-w-[140px] border-l border-border-dark pl-4 ml-auto">
<span class="text-text-secondary text-xs font-medium uppercase tracking-wider">60d Rate Resets</span>
<div class="flex items-baseline gap-2">
<span class="text-white text-xl font-bold font-mono tracking-tight">8</span>
<span class="text-text-secondary text-xs font-medium">Review Req.</span>
</div>
</div>
</div>
</section>
<!-- Split Pane View -->
<div class="flex flex-1 overflow-hidden">
<!-- LEFT PANE: Portfolio Table -->
<div class="flex flex-col w-[65%] border-r border-border-dark bg-background-dark min-w-[600px]">
<!-- Table Controls -->
<div class="flex flex-col border-b border-border-dark bg-surface-darker">
<!-- Tabs -->
<div class="flex items-center px-4 gap-6 pt-3 overflow-x-auto no-scrollbar">
<button class="pb-3 border-b-2 border-primary text-white text-sm font-semibold tracking-wide whitespace-nowrap">All Active <span class="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">42</span></button>
<button class="pb-3 border-b-2 border-transparent text-text-secondary hover:text-white text-sm font-medium tracking-wide whitespace-nowrap transition-colors">Watchlist <span class="ml-1.5 text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded-full">4</span></button>
<button class="pb-3 border-b-2 border-transparent text-text-secondary hover:text-white text-sm font-medium tracking-wide whitespace-nowrap transition-colors">Near Breach <span class="ml-1.5 text-xs bg-danger/20 text-danger px-1.5 py-0.5 rounded-full">2</span></button>
<button class="pb-3 border-b-2 border-transparent text-text-secondary hover:text-white text-sm font-medium tracking-wide whitespace-nowrap transition-colors">IO Loans</button>
<button class="pb-3 border-b-2 border-transparent text-text-secondary hover:text-white text-sm font-medium tracking-wide whitespace-nowrap transition-colors">Variable Rate</button>
<button class="pb-3 border-b-2 border-transparent text-text-secondary hover:text-white text-sm font-medium tracking-wide whitespace-nowrap transition-colors">Reporting Missing</button>
<button class="pb-3 border-b-2 border-transparent text-text-secondary hover:text-white text-sm font-medium tracking-wide whitespace-nowrap transition-colors">Maturity &lt; 180d</button>
</div>
<!-- Filters -->
<div class="flex items-center gap-3 p-3 bg-surface-dark border-t border-border-dark overflow-x-auto">
<div class="flex items-center bg-background-dark border border-border-dark rounded-md px-2 py-1 gap-2">
<span class="material-symbols-outlined text-text-secondary text-[18px]">filter_list</span>
<span class="text-xs font-medium text-text-secondary uppercase">Filters:</span>
</div>
<button class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-background-dark border border-border-dark rounded-md hover:bg-surface-darker transition-colors whitespace-nowrap">
                                Asset Type <span class="material-symbols-outlined text-[14px] text-text-secondary">arrow_drop_down</span>
</button>
<button class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-background-dark border border-border-dark rounded-md hover:bg-surface-darker transition-colors whitespace-nowrap">
                                Geography <span class="material-symbols-outlined text-[14px] text-text-secondary">arrow_drop_down</span>
</button>
<button class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-background-dark border border-border-dark rounded-md hover:bg-surface-darker transition-colors whitespace-nowrap">
                                Rate Type <span class="material-symbols-outlined text-[14px] text-text-secondary">arrow_drop_down</span>
</button>
<button class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-background-dark border border-border-dark rounded-md hover:bg-surface-darker transition-colors whitespace-nowrap">
                                Risk Rating <span class="material-symbols-outlined text-[14px] text-text-secondary">arrow_drop_down</span>
</button>
<div class="h-4 w-px bg-border-dark mx-1"></div>
<label class="flex items-center gap-2 cursor-pointer select-none">
<div class="relative inline-block w-8 h-4 align-middle select-none transition duration-200 ease-in">
<input class="toggle-checkbox absolute block w-3 h-3 rounded-full bg-white border-4 appearance-none cursor-pointer left-0.5 top-0.5 checked:bg-primary checked:left-4.5 transition-all" name="toggle" type="checkbox"/>
<div class="toggle-label block overflow-hidden h-4 rounded-full bg-border-dark cursor-pointer"></div>
</div>
<span class="text-xs font-medium text-text-secondary">Only Tracking Required</span>
</label>
<div class="flex-1"></div>
<button class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-white transition-colors">
<span class="material-symbols-outlined text-[16px]">sort</span> Sort by: Priority
                            </button>
</div>
</div>
<!-- Data Grid -->
<div class="flex-1 overflow-auto bg-background-dark">
<table class="w-full text-left border-collapse">
<thead class="sticky top-0 bg-surface-darker z-10 text-xs font-semibold text-text-secondary uppercase tracking-wider border-b border-border-dark">
<tr>
<th class="px-4 py-3 min-w-[200px]">Loan / Deal Name</th>
<th class="px-4 py-3 text-right">UPB</th>
<th class="px-4 py-3 text-right">All-in Rate</th>
<th class="px-4 py-3 text-right">Profit (Ann)</th>
<th class="px-4 py-3 text-right">DSCR</th>
<th class="px-4 py-3 text-right">LTV</th>
<th class="px-4 py-3 text-center">IO Status</th>
<th class="px-4 py-3">Tracking Flags</th>
<th class="px-4 py-3 text-right text-text-secondary/60">Updated</th>
</tr>
</thead>
<tbody class="text-sm font-medium text-white divide-y divide-border-dark">
<!-- Row 1 - Selected -->
<tr class="bg-primary/5 hover:bg-primary/10 cursor-pointer group border-l-[3px] border-primary">
<td class="px-4 py-3">
<div class="flex flex-col">
<span class="font-bold text-white group-hover:text-primary transition-colors">Highland Retail Village</span>
<span class="text-xs text-text-secondary font-normal">Blackstone RE • TX</span>
</div>
</td>
<td class="px-4 py-3 text-right font-mono text-white/90">$45.2M</td>
<td class="px-4 py-3 text-right font-mono text-white/90">7.85%</td>
<td class="px-4 py-3 text-right font-mono text-success">$1.2M</td>
<td class="px-4 py-3 text-right font-mono text-danger font-bold">1.15x</td>
<td class="px-4 py-3 text-right font-mono text-white/90">62%</td>
<td class="px-4 py-3 text-center">
<span class="px-2 py-0.5 rounded text-xs bg-surface-dark border border-border-dark text-text-secondary font-mono">Amort</span>
</td>
<td class="px-4 py-3">
<div class="flex flex-wrap gap-1.5">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-danger/20 text-danger border border-danger/30 uppercase tracking-wide">Covenant Breach</span>
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-warning/20 text-warning border border-warning/30 uppercase tracking-wide">Rate Reset 14d</span>
</div>
</td>
<td class="px-4 py-3 text-right text-xs text-text-secondary">2m ago</td>
</tr>
<!-- Row 2 -->
<tr class="hover:bg-surface-dark cursor-pointer border-l-[3px] border-transparent">
<td class="px-4 py-3">
<div class="flex flex-col">
<span class="font-semibold text-white/90">Skyline Logistics Center</span>
<span class="text-xs text-text-secondary font-normal">Prologis • CA</span>
</div>
</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">$128.5M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">6.50%</td>
<td class="px-4 py-3 text-right font-mono text-success">$3.8M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">1.45x</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">55%</td>
<td class="px-4 py-3 text-center">
<span class="px-2 py-0.5 rounded text-xs bg-primary/20 border border-primary/30 text-primary font-mono">IO: 4m</span>
</td>
<td class="px-4 py-3">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-dark text-text-secondary border border-border-dark uppercase tracking-wide">Clean</span>
</td>
<td class="px-4 py-3 text-right text-xs text-text-secondary">1d ago</td>
</tr>
<!-- Row 3 -->
<tr class="hover:bg-surface-dark cursor-pointer border-l-[3px] border-transparent">
<td class="px-4 py-3">
<div class="flex flex-col">
<span class="font-semibold text-white/90">Beacon Office Tower II</span>
<span class="text-xs text-text-secondary font-normal">Brookfield • NY</span>
</div>
</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">$210.0M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">8.15%</td>
<td class="px-4 py-3 text-right font-mono text-success">$5.1M</td>
<td class="px-4 py-3 text-right font-mono text-warning font-bold">1.22x</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">68%</td>
<td class="px-4 py-3 text-center">
<span class="px-2 py-0.5 rounded text-xs bg-surface-dark border border-border-dark text-text-secondary font-mono">Amort</span>
</td>
<td class="px-4 py-3">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-warning/20 text-warning border border-warning/30 uppercase tracking-wide">Watchlist</span>
</td>
<td class="px-4 py-3 text-right text-xs text-text-secondary">4h ago</td>
</tr>
<!-- Row 4 -->
<tr class="hover:bg-surface-dark cursor-pointer border-l-[3px] border-transparent">
<td class="px-4 py-3">
<div class="flex flex-col">
<span class="font-semibold text-white/90">Greenwood Multifamily Portfolio</span>
<span class="text-xs text-text-secondary font-normal">Greystar • FL</span>
</div>
</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">$88.4M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">7.10%</td>
<td class="px-4 py-3 text-right font-mono text-success">$2.4M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">1.38x</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">60%</td>
<td class="px-4 py-3 text-center">
<span class="px-2 py-0.5 rounded text-xs bg-primary/20 border border-primary/30 text-primary font-mono">IO: 12m</span>
</td>
<td class="px-4 py-3">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 uppercase tracking-wide">Insur. Exp 15d</span>
</td>
<td class="px-4 py-3 text-right text-xs text-text-secondary">Today</td>
</tr>
<!-- Row 5 -->
<tr class="hover:bg-surface-dark cursor-pointer border-l-[3px] border-transparent">
<td class="px-4 py-3">
<div class="flex flex-col">
<span class="font-semibold text-white/90">Westside Industrial Park</span>
<span class="text-xs text-text-secondary font-normal">Link Logistics • NV</span>
</div>
</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">$32.0M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">6.95%</td>
<td class="px-4 py-3 text-right font-mono text-success">$0.9M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">1.55x</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">50%</td>
<td class="px-4 py-3 text-center">
<span class="px-2 py-0.5 rounded text-xs bg-surface-dark border border-border-dark text-text-secondary font-mono">Amort</span>
</td>
<td class="px-4 py-3">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-dark text-text-secondary border border-border-dark uppercase tracking-wide">Clean</span>
</td>
<td class="px-4 py-3 text-right text-xs text-text-secondary">Yesterday</td>
</tr>
<!-- Row 6 -->
<tr class="hover:bg-surface-dark cursor-pointer border-l-[3px] border-transparent">
<td class="px-4 py-3">
<div class="flex flex-col">
<span class="font-semibold text-white/90">Harbor View Hotel</span>
<span class="text-xs text-text-secondary font-normal">Host Hotels • MA</span>
</div>
</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">$65.0M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">8.50%</td>
<td class="px-4 py-3 text-right font-mono text-success">$1.8M</td>
<td class="px-4 py-3 text-right font-mono text-danger font-bold">1.05x</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">72%</td>
<td class="px-4 py-3 text-center">
<span class="px-2 py-0.5 rounded text-xs bg-surface-dark border border-border-dark text-text-secondary font-mono">Amort</span>
</td>
<td class="px-4 py-3">
<div class="flex flex-wrap gap-1.5">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-danger/20 text-danger border border-danger/30 uppercase tracking-wide">Near Breach</span>
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-700 text-gray-400 border border-gray-600 uppercase tracking-wide">Rpt Missing</span>
</div>
</td>
<td class="px-4 py-3 text-right text-xs text-text-secondary">3d ago</td>
</tr>
<!-- Row 7 -->
<tr class="hover:bg-surface-dark cursor-pointer border-l-[3px] border-transparent">
<td class="px-4 py-3">
<div class="flex flex-col">
<span class="font-semibold text-white/90">Lakeside Medical Office</span>
<span class="text-xs text-text-secondary font-normal">Physicians Realty • IL</span>
</div>
</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">$18.5M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">7.25%</td>
<td class="px-4 py-3 text-right font-mono text-success">$0.5M</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">1.60x</td>
<td class="px-4 py-3 text-right font-mono text-text-secondary">58%</td>
<td class="px-4 py-3 text-center">
<span class="px-2 py-0.5 rounded text-xs bg-primary/20 border border-primary/30 text-primary font-mono">IO: 24m</span>
</td>
<td class="px-4 py-3">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-dark text-text-secondary border border-border-dark uppercase tracking-wide">Clean</span>
</td>
<td class="px-4 py-3 text-right text-xs text-text-secondary">5d ago</td>
</tr>
<!-- Filler rows for density -->
<tr class="hover:bg-surface-dark cursor-pointer border-l-[3px] border-transparent opacity-60">
<td class="px-4 py-3"><span class="font-semibold">Centennial Mall</span></td>
<td class="px-4 py-3 text-right font-mono">$92.1M</td>
<td class="px-4 py-3 text-right font-mono">7.40%</td>
<td class="px-4 py-3 text-right font-mono">$2.1M</td>
<td class="px-4 py-3 text-right font-mono">1.32x</td>
<td class="px-4 py-3 text-right font-mono">65%</td>
<td class="px-4 py-3 text-center"><span class="text-xs">Amort</span></td>
<td class="px-4 py-3"><span class="text-[10px] uppercase">Clean</span></td>
<td class="px-4 py-3 text-right text-xs">1w ago</td>
</tr>
<tr class="hover:bg-surface-dark cursor-pointer border-l-[3px] border-transparent opacity-60">
<td class="px-4 py-3"><span class="font-semibold">Oak Creek Apartments</span></td>
<td class="px-4 py-3 text-right font-mono">$28.4M</td>
<td class="px-4 py-3 text-right font-mono">6.80%</td>
<td class="px-4 py-3 text-right font-mono">$0.8M</td>
<td class="px-4 py-3 text-right font-mono">1.41x</td>
<td class="px-4 py-3 text-right font-mono">61%</td>
<td class="px-4 py-3 text-center"><span class="text-xs">IO: 8m</span></td>
<td class="px-4 py-3"><span class="text-[10px] uppercase">Clean</span></td>
<td class="px-4 py-3 text-right text-xs">1w ago</td>
</tr>
</tbody>
</table>
</div>
</div>
<!-- RIGHT PANE: Selected Loan Detail -->
<div class="flex flex-col flex-1 bg-surface-darker overflow-y-auto w-[35%] min-w-[380px] border-l border-border-dark relative">
<!-- Detail Header -->
<div class="px-6 py-5 border-b border-border-dark bg-background-dark/50 backdrop-blur sticky top-0 z-20">
<div class="flex items-start justify-between mb-2">
<div>
<h1 class="text-xl font-bold text-white leading-tight">Highland Retail Village</h1>
<p class="text-sm text-text-secondary mt-0.5">1200 Highland Ave, Austin, TX</p>
</div>
<div class="flex gap-2">
<span class="px-2 py-1 rounded bg-success/20 text-success text-xs font-bold border border-success/30 uppercase">Active</span>
<span class="px-2 py-1 rounded bg-danger/20 text-danger text-xs font-bold border border-danger/30 uppercase">Watchlist</span>
</div>
</div>
<div class="flex items-center gap-4 text-sm text-text-secondary mb-4">
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">business</span> Blackstone RE</span>
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">category</span> Retail</span>
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">tag</span> #LN-2023-849</span>
</div>
<div class="flex gap-2">
<button class="flex-1 bg-primary hover:bg-primary/90 text-white text-sm font-bold py-2 px-4 rounded shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-[18px]">open_in_new</span> Open Underwriting
                            </button>
<button class="bg-surface-dark hover:bg-border-dark border border-border-dark text-white p-2 rounded transition-colors" title="Log Note">
<span class="material-symbols-outlined text-[20px]">edit_note</span>
</button>
<button class="bg-surface-dark hover:bg-border-dark border border-border-dark text-white p-2 rounded transition-colors" title="Export Snapshot">
<span class="material-symbols-outlined text-[20px]">download</span>
</button>
</div>
</div>
<div class="p-6 flex flex-col gap-6">
<!-- Next Best Actions -->
<div class="flex flex-col gap-3">
<div class="flex items-center justify-between">
<h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider">Next Best Actions</h3>
</div>
<div class="flex flex-col gap-2">
<!-- Action 1 -->
<div class="bg-surface-dark border border-l-4 border-l-danger border-y-border-dark border-r-border-dark rounded p-3 shadow-sm">
<div class="flex justify-between items-start mb-1">
<span class="text-sm font-semibold text-white">Review Covenant Breach</span>
<span class="text-xs font-bold text-danger">Due: Today</span>
</div>
<p class="text-xs text-text-secondary mb-3">DSCR fell below 1.20x threshold. Review latest rent roll.</p>
<div class="flex gap-2">
<button class="text-xs bg-danger/10 hover:bg-danger/20 text-danger px-3 py-1.5 rounded font-semibold transition-colors">Action</button>
<button class="text-xs text-text-secondary hover:text-white px-2 py-1.5">Dismiss</button>
</div>
</div>
<!-- Action 2 -->
<div class="bg-surface-dark border border-l-4 border-l-warning border-y-border-dark border-r-border-dark rounded p-3 shadow-sm">
<div class="flex justify-between items-start mb-1">
<span class="text-sm font-semibold text-white">Approve Rate Reset</span>
<span class="text-xs font-bold text-warning">Due: 2 Days</span>
</div>
<p class="text-xs text-text-secondary mb-3">Variable rate resets on Oct 15. Confirm index + spread.</p>
<div class="flex gap-2">
<button class="text-xs bg-warning/10 hover:bg-warning/20 text-warning px-3 py-1.5 rounded font-semibold transition-colors">Review</button>
</div>
</div>
</div>
</div>
<!-- Profitability Module -->
<div class="flex flex-col gap-3">
<h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-2">
<span class="material-symbols-outlined text-[16px]">monetization_on</span> Profitability
                            </h3>
<div class="grid grid-cols-2 gap-3">
<div class="bg-surface-dark p-3 rounded border border-border-dark">
<span class="text-[10px] text-text-secondary uppercase block mb-1">Ann. Net Interest Inc.</span>
<span class="text-lg font-bold text-white font-mono">$1.24M</span>
</div>
<div class="bg-surface-dark p-3 rounded border border-border-dark">
<span class="text-[10px] text-text-secondary uppercase block mb-1">Net Spread</span>
<span class="text-lg font-bold text-success font-mono">215 bps</span>
</div>
</div>
<div class="bg-surface-dark p-3 rounded border border-border-dark flex justify-between items-center">
<div>
<span class="text-[10px] text-text-secondary uppercase block">Proj. 12m Profit</span>
<span class="text-sm font-bold text-white font-mono">$1,245,000</span>
</div>
<div class="h-8 w-24 bg-gradient-to-r from-surface-darker to-success/20 rounded relative overflow-hidden" data-alt="Small profitability sparkline chart">
<!-- Simple CSS Sparkline representation -->
<svg class="absolute inset-0 w-full h-full" preserveaspectratio="none">
<path d="M0 32 L5 28 L10 30 L15 20 L20 22 L25 10 L30 15 L35 5 L40 8 L45 2 L50 4 L55 0 L96 0 L96 32 Z" fill="rgba(45, 164, 78, 0.2)"></path>
<path d="M0 32 L5 28 L10 30 L15 20 L20 22 L25 10 L30 15 L35 5 L40 8 L45 2 L50 4 L55 0" fill="none" stroke="#2da44e" stroke-width="2"></path>
</svg>
</div>
</div>
</div>
<!-- Covenant & Drift Snapshot -->
<div class="flex flex-col gap-3">
<h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-2">
<span class="material-symbols-outlined text-[16px]">gavel</span> Covenants &amp; Drift
                            </h3>
<div class="grid grid-cols-3 gap-2">
<!-- Tile 1: DSCR -->
<div class="bg-surface-dark p-2 rounded border border-danger/50 relative overflow-hidden group">
<div class="absolute top-0 right-0 p-1">
<div class="size-2 rounded-full bg-danger"></div>
</div>
<span class="text-[10px] text-text-secondary uppercase">DSCR</span>
<div class="mt-1">
<span class="text-lg font-bold text-white font-mono">1.15x</span>
</div>
<div class="text-[10px] text-text-secondary mt-1">
                                        Limit: <span class="text-danger font-semibold">1.20x</span>
</div>
</div>
<!-- Tile 2: LTV -->
<div class="bg-surface-dark p-2 rounded border border-border-dark relative overflow-hidden">
<span class="text-[10px] text-text-secondary uppercase">LTV</span>
<div class="mt-1">
<span class="text-lg font-bold text-white font-mono">62%</span>
</div>
<div class="text-[10px] text-text-secondary mt-1">
                                        Max: <span class="text-white font-semibold">70%</span>
</div>
</div>
<!-- Tile 3: Occupancy -->
<div class="bg-surface-dark p-2 rounded border border-border-dark relative overflow-hidden">
<span class="text-[10px] text-text-secondary uppercase">Occ.</span>
<div class="mt-1">
<span class="text-lg font-bold text-white font-mono">94%</span>
</div>
<div class="text-[10px] text-text-secondary mt-1">
                                        Min: <span class="text-white font-semibold">90%</span>
</div>
</div>
</div>
</div>
<!-- Rate Tracking -->
<div class="flex flex-col gap-3">
<h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-2">
<span class="material-symbols-outlined text-[16px]">percent</span> Rate Tracking
                            </h3>
<div class="bg-surface-dark rounded border border-border-dark overflow-hidden">
<div class="p-3 grid grid-cols-2 gap-y-4 gap-x-2 text-xs">
<div>
<span class="text-text-secondary block">Rate Type</span>
<span class="font-semibold text-white">Variable (SOFR 1M)</span>
</div>
<div>
<span class="text-text-secondary block">Current All-in</span>
<span class="font-semibold text-white font-mono">7.85%</span>
</div>
<div>
<span class="text-text-secondary block">Spread</span>
<span class="font-semibold text-white font-mono">+250 bps</span>
</div>
<div>
<span class="text-text-secondary block">Next Reset</span>
<span class="font-semibold text-warning">Oct 15 (14d)</span>
</div>
</div>
<div class="bg-surface-darker px-3 py-2 border-t border-border-dark flex justify-between items-center">
<span class="text-xs text-text-secondary">Est. Reset Impact</span>
<span class="text-xs font-bold text-danger flex items-center gap-1">
<span class="material-symbols-outlined text-[12px]">arrow_upward</span> +$12k / mo
                                    </span>
</div>
</div>
</div>
<!-- Activity Trail -->
<div class="flex flex-col gap-3 pb-6">
<h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider">Activity Log</h3>
<div class="relative border-l border-border-dark ml-2 space-y-4">
<div class="ml-4 relative">
<div class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-border-dark border border-surface-darker"></div>
<p class="text-xs text-text-secondary">Today, 9:42 AM</p>
<p class="text-xs font-medium text-white">System detected DSCR Breach (1.15x)</p>
</div>
<div class="ml-4 relative">
<div class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-border-dark border border-surface-darker"></div>
<p class="text-xs text-text-secondary">Yesterday, 4:15 PM</p>
<p class="text-xs font-medium text-white">Updated Rent Roll uploaded by J.Doe</p>
</div>
<div class="ml-4 relative">
<div class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-border-dark border border-surface-darker"></div>
<p class="text-xs text-text-secondary">Oct 1, 10:00 AM</p>
<p class="text-xs font-medium text-white">Monthly Payment Received ($245k)</p>
</div>
</div>
</div>
</div>
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
