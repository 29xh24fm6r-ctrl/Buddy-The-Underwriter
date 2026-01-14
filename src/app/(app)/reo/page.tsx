import { redirect } from "next/navigation";

const TITLE = "Buddy - REO Asset Management Command Center";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "background-light": "#f6f7f8",
                        "background-dark": "#0f172a", // Slate 900
                        "surface-dark": "#1e293b", // Slate 800
                        "border-dark": "#334155", // Slate 700
                        "success": "#10b981",
                        "warning": "#f59e0b",
                        "danger": "#ef4444",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"]
                    },
                    fontSize: {
                        "xxs": "0.65rem",
                    }
                },
            },
        }`;
const STYLES = [
  "/* Custom scrollbar for high density data apps */\n        ::-webkit-scrollbar { width: 6px; height: 6px; }\n        ::-webkit-scrollbar-track { background: transparent; }\n        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }\n        ::-webkit-scrollbar-thumb:hover { background: #475569; }\n        \n        .glass-panel {\n            background: rgba(30, 41, 59, 0.6);\n            backdrop-filter: blur(12px);\n            border: 1px solid rgba(255, 255, 255, 0.08);\n        }\n        \n        .glass-header {\n            background: rgba(15, 23, 42, 0.85);\n            backdrop-filter: blur(12px);\n            border-bottom: 1px solid rgba(255, 255, 255, 0.08);\n        }\n\n        .stepper-line {\n            position: absolute;\n            top: 50%;\n            left: 0;\n            width: 100%;\n            height: 2px;\n            background-color: #334155;\n            z-index: 0;\n            transform: translateY(-50%);\n        }"
];
const BODY_HTML = `<!-- Global Header -->
<header class="glass-header h-14 flex items-center justify-between px-5 shrink-0 z-50">
<div class="flex items-center gap-6">
<!-- Logo -->
<div class="flex items-center gap-2 text-white">
<div class="size-5 text-primary">
<svg class="w-full h-full" fill="none" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<path d="M24 4L44 24L24 44L4 24L24 4Z" fill="currentColor"></path>
<path d="M24 10V24L10 24" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"></path>
</svg>
</div>
<h2 class="text-white text-base font-bold tracking-tight">Buddy</h2>
</div>
<!-- Global Nav -->
<nav class="flex items-center gap-1">
<a class="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white rounded hover:bg-white/5 transition-colors" href="#">Deals</a>
<a class="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white rounded hover:bg-white/5 transition-colors" href="#">Intake</a>
<a class="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white rounded hover:bg-white/5 transition-colors" href="#">Portfolio</a>
<a class="px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary border border-primary/20 rounded shadow-sm" href="#">REO</a>
<a class="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white rounded hover:bg-white/5 transition-colors" href="#">Reporting</a>
<a class="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white rounded hover:bg-white/5 transition-colors" href="#">Legal</a>
</nav>
</div>
<div class="flex items-center gap-4">
<!-- Search -->
<div class="relative w-64 h-8 group">
<span class="material-symbols-outlined absolute left-2.5 top-1.5 text-slate-500 text-[18px]">search</span>
<input class="w-full h-full bg-surface-dark border border-border-dark rounded-full pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all" placeholder="Global Search..." type="text"/>
<div class="absolute right-2 top-1.5 flex items-center gap-1 pointer-events-none">
<kbd class="text-[10px] text-slate-600 font-sans border border-border-dark rounded px-1 bg-background-dark">⌘K</kbd>
</div>
</div>
<!-- Utilities -->
<div class="flex items-center gap-3 border-l border-white/10 pl-4">
<button class="relative text-slate-400 hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">notifications</span>
<span class="absolute top-0 right-0 size-2 bg-danger rounded-full border border-background-dark"></span>
</button>
<div class="size-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 border border-white/10 bg-cover bg-center" data-alt="User Avatar" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuBzp6-77LT6moaEvUtgMi4oVjfKaCMPQqptCrCPl8Xw-NF89OarXer2t5K46-ConXXKh_HDtCCOevXeUBHnWrBAyFiDKL7tHC3TbDjUi9M7bo8DRbjrhYslPS0ZKfWRoajYukybcyAoMK8vMqcxdR1FvpRvYdTxmjNu1uSpBLalelYvHEdG7O0OPMUsdpF5u_yqbkfQ_TICYJ6Qxs32q2M7tFQjiZ3mfHKIluIp3BqsI2oS_J5rjDPQhRD9zx5yXQ3jCx564XU6HN0');"></div>
</div>
</div>
</header>
<!-- Main Content: 3-Column Cockpit -->
<main class="flex-1 flex overflow-hidden">
<!-- LEFT COLUMN: Inventory Queue -->
<aside class="w-[340px] flex flex-col border-r border-border-dark bg-[#111620] shrink-0 z-20 shadow-xl">
<!-- Queue Header -->
<div class="p-4 border-b border-border-dark space-y-3">
<div class="flex items-center justify-between">
<h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Inventory Queue</h3>
<span class="bg-primary/20 text-primary text-[10px] font-bold px-1.5 py-0.5 rounded">14 Active</span>
</div>
<!-- Search -->
<div class="relative">
<input class="w-full bg-surface-dark/50 border border-border-dark rounded-md py-1.5 pl-3 pr-8 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary" placeholder="Search asset, city, broker..." type="text"/>
<span class="material-symbols-outlined absolute right-2 top-1.5 text-slate-500 text-[16px]">filter_list</span>
</div>
<!-- Chips -->
<div class="flex flex-wrap gap-2">
<button class="px-2 py-1 rounded bg-surface-dark border border-border-dark text-[10px] text-slate-300 hover:border-slate-500 flex items-center gap-1">
                        Status <span class="material-symbols-outlined text-[10px]">expand_more</span>
</button>
<button class="px-2 py-1 rounded bg-surface-dark border border-border-dark text-[10px] text-slate-300 hover:border-slate-500 flex items-center gap-1">
                        Region <span class="material-symbols-outlined text-[10px]">expand_more</span>
</button>
<button class="px-2 py-1 rounded bg-surface-dark border border-border-dark text-[10px] text-slate-300 hover:border-slate-500 flex items-center gap-1">
                        Severity <span class="material-symbols-outlined text-[10px]">expand_more</span>
</button>
</div>
</div>
<!-- Asset List -->
<div class="flex-1 overflow-y-auto">
<!-- Selected Item -->
<div class="group relative p-3 border-b border-border-dark bg-primary/10 border-l-[3px] border-l-primary cursor-pointer">
<div class="flex justify-between items-start mb-1">
<span class="text-sm font-semibold text-white truncate max-w-[180px]">Harbor View Multifamily</span>
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/20">Stabilize</span>
</div>
<div class="text-xs text-slate-400 mb-2">Boston, MA • Owned 14d</div>
<div class="grid grid-cols-3 gap-2 text-[10px]">
<div>
<span class="block text-slate-500">Occ</span>
<span class="text-white font-medium">88%</span>
</div>
<div>
<span class="block text-slate-500">NOI</span>
<span class="text-white font-medium">$125k</span>
</div>
<div>
<span class="block text-slate-500">Next</span>
<span class="text-warning">Insp.</span>
</div>
</div>
</div>
<!-- Item 2 -->
<div class="group relative p-3 border-b border-border-dark hover:bg-white/5 border-l-[3px] border-l-transparent cursor-pointer transition-colors">
<div class="flex justify-between items-start mb-1">
<span class="text-sm font-medium text-slate-300 truncate max-w-[180px]">Apex Industrial Park</span>
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/20">List</span>
</div>
<div class="text-xs text-slate-500 mb-2">Austin, TX • Owned 45d</div>
<div class="grid grid-cols-3 gap-2 text-[10px]">
<div>
<span class="block text-slate-600">Occ</span>
<span class="text-slate-300">40%</span>
</div>
<div>
<span class="block text-slate-600">NOI</span>
<span class="text-danger">-$12k</span>
</div>
<div>
<span class="block text-slate-600">Next</span>
<span class="text-slate-300">BOV</span>
</div>
</div>
</div>
<!-- Item 3 -->
<div class="group relative p-3 border-b border-border-dark hover:bg-white/5 border-l-[3px] border-l-transparent cursor-pointer transition-colors">
<div class="flex justify-between items-start mb-1">
<span class="text-sm font-medium text-slate-300 truncate max-w-[180px]">Sunset Strip Retail</span>
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/20">Evict</span>
</div>
<div class="text-xs text-slate-500 mb-2">Los Angeles, CA • Owned 2d</div>
<div class="grid grid-cols-3 gap-2 text-[10px]">
<div>
<span class="block text-slate-600">Occ</span>
<span class="text-slate-300">12%</span>
</div>
<div>
<span class="block text-slate-600">NOI</span>
<span class="text-slate-300">$0</span>
</div>
<div>
<span class="block text-slate-600">Next</span>
<span class="text-danger">Legal</span>
</div>
</div>
</div>
<!-- Item 4 -->
<div class="group relative p-3 border-b border-border-dark hover:bg-white/5 border-l-[3px] border-l-transparent cursor-pointer transition-colors">
<div class="flex justify-between items-start mb-1">
<span class="text-sm font-medium text-slate-300 truncate max-w-[180px]">Highland Heights</span>
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/20">Close</span>
</div>
<div class="text-xs text-slate-500 mb-2">Denver, CO • Owned 120d</div>
<div class="grid grid-cols-3 gap-2 text-[10px]">
<div>
<span class="block text-slate-600">Occ</span>
<span class="text-slate-300">95%</span>
</div>
<div>
<span class="block text-slate-600">NOI</span>
<span class="text-slate-300">$45k</span>
</div>
<div>
<span class="block text-slate-600">Next</span>
<span class="text-slate-300">Wire</span>
</div>
</div>
</div>
</div>
</aside>
<!-- CENTER COLUMN: Asset Ops Truth -->
<section class="flex-1 flex flex-col min-w-0 bg-background-dark/50 relative">
<div class="flex-1 overflow-y-auto pb-20">
<!-- Selected Asset Header -->
<div class="p-6 border-b border-border-dark bg-surface-dark/40">
<div class="flex items-start justify-between mb-6">
<div>
<div class="flex items-center gap-3 mb-1">
<h1 class="text-2xl font-bold text-white tracking-tight">Harbor View Multifamily <span class="text-slate-500 font-normal">(REO)</span></h1>
<span class="material-symbols-outlined text-slate-500 text-sm cursor-help">info</span>
</div>
<div class="flex items-center gap-4 text-xs text-slate-400">
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">location_on</span> Boston, MA</span>
<span class="w-1 h-1 rounded-full bg-slate-600"></span>
<span>Acquired: <span class="text-slate-200">Aug 18, 2025</span></span>
<span class="w-1 h-1 rounded-full bg-slate-600"></span>
<span>PM: <span class="text-primary cursor-pointer hover:underline">Greystone PM</span></span>
<span class="w-1 h-1 rounded-full bg-slate-600"></span>
<span>Broker: <span class="text-slate-200">CBRE — J. Lin</span></span>
</div>
</div>
<button class="flex items-center gap-1 text-xs text-slate-400 border border-border-dark px-2 py-1 rounded bg-surface-dark hover:bg-white/5 transition-colors">
<span class="material-symbols-outlined text-[14px]">share</span> Share
                        </button>
</div>
<!-- Status Stepper -->
<div class="relative px-4 py-2">
<div class="stepper-line"></div>
<div class="relative z-10 flex justify-between">
<!-- Step 1 -->
<div class="flex flex-col items-center gap-2 group cursor-pointer">
<div class="size-6 rounded-full bg-primary border-2 border-background-dark flex items-center justify-center text-white">
<span class="material-symbols-outlined text-[14px]">check</span>
</div>
<span class="text-[10px] font-semibold text-primary uppercase">Takeover</span>
</div>
<!-- Step 2 (Active) -->
<div class="flex flex-col items-center gap-2 group cursor-pointer">
<div class="size-6 rounded-full bg-primary border-2 border-primary shadow-[0_0_10px_rgba(19,109,236,0.5)] flex items-center justify-center text-white animate-pulse">
<span class="material-symbols-outlined text-[14px]">build</span>
</div>
<span class="text-[10px] font-bold text-white uppercase">Stabilize</span>
</div>
<!-- Step 3 -->
<div class="flex flex-col items-center gap-2 group cursor-pointer">
<div class="size-6 rounded-full bg-surface-dark border-2 border-slate-500 flex items-center justify-center text-slate-400">
<span class="text-[10px] font-bold">3</span>
</div>
<span class="text-[10px] font-medium text-slate-500 uppercase">List</span>
</div>
<!-- Step 4 -->
<div class="flex flex-col items-center gap-2 group cursor-pointer">
<div class="size-6 rounded-full bg-surface-dark border-2 border-slate-600 flex items-center justify-center text-slate-500">
<span class="text-[10px] font-bold">4</span>
</div>
<span class="text-[10px] font-medium text-slate-600 uppercase">Contract</span>
</div>
<!-- Step 5 -->
<div class="flex flex-col items-center gap-2 group cursor-pointer">
<div class="size-6 rounded-full bg-surface-dark border-2 border-slate-600 flex items-center justify-center text-slate-500">
<span class="text-[10px] font-bold">5</span>
</div>
<span class="text-[10px] font-medium text-slate-600 uppercase">Close</span>
</div>
</div>
</div>
</div>
<!-- Ops KPI Strip -->
<div class="grid grid-cols-4 gap-3 p-6 pt-4">
<!-- Tile 1 -->
<div class="glass-panel p-3 rounded-lg flex flex-col gap-1">
<span class="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Occupancy</span>
<div class="flex items-end justify-between">
<span class="text-xl font-bold text-white">92%</span>
<span class="text-xs text-danger flex items-center">▼ 1.2%</span>
</div>
<span class="text-[9px] text-slate-600 mt-1">Updated: Today 09:12</span>
</div>
<!-- Tile 2 -->
<div class="glass-panel p-3 rounded-lg flex flex-col gap-1">
<span class="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Collections</span>
<div class="flex items-end justify-between">
<span class="text-xl font-bold text-white">98%</span>
<span class="text-xs text-success flex items-center">▲ 0.5%</span>
</div>
<span class="text-[9px] text-slate-600 mt-1">Updated: Today 09:12</span>
</div>
<!-- Tile 3 -->
<div class="glass-panel p-3 rounded-lg flex flex-col gap-1">
<span class="text-[10px] font-medium text-slate-400 uppercase tracking-wide">NOI (TTM)</span>
<div class="flex items-end justify-between">
<span class="text-xl font-bold text-white">$1.2M</span>
<span class="text-xs text-slate-400">Actual</span>
</div>
<span class="text-[9px] text-slate-600 mt-1">Source: Yardi</span>
</div>
<!-- Tile 4 -->
<div class="glass-panel p-3 rounded-lg flex flex-col gap-1 border-l-4 border-l-warning border-y border-r border-border-dark">
<span class="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Work Orders</span>
<div class="flex items-end justify-between">
<span class="text-xl font-bold text-warning">3</span>
<span class="text-xs text-warning font-medium">Critical</span>
</div>
<span class="text-[9px] text-slate-600 mt-1">Needs Approval</span>
</div>
</div>
<!-- Performance Panel -->
<div class="px-6 pb-6">
<div class="glass-panel rounded-lg p-4">
<div class="flex items-center justify-between mb-4">
<h4 class="text-sm font-semibold text-white">Property Performance</h4>
<div class="flex gap-2">
<span class="px-2 py-0.5 text-[10px] bg-white/5 rounded text-slate-300 border border-white/10">Last 12 Months</span>
</div>
</div>
<!-- Pseudo Chart Area -->
<div class="flex items-end gap-2 h-24 w-full border-b border-white/10 pb-1 px-1">
<!-- Bars representing NOI Trend -->
<div class="flex-1 bg-primary/30 rounded-t-sm h-[40%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Jan</div></div>
<div class="flex-1 bg-primary/30 rounded-t-sm h-[45%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Feb</div></div>
<div class="flex-1 bg-primary/30 rounded-t-sm h-[55%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Mar</div></div>
<div class="flex-1 bg-primary/30 rounded-t-sm h-[50%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Apr</div></div>
<div class="flex-1 bg-primary/40 rounded-t-sm h-[60%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">May</div></div>
<div class="flex-1 bg-primary/40 rounded-t-sm h-[65%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Jun</div></div>
<div class="flex-1 bg-primary/50 rounded-t-sm h-[70%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Jul</div></div>
<div class="flex-1 bg-primary/50 rounded-t-sm h-[75%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Aug</div></div>
<div class="flex-1 bg-primary/60 rounded-t-sm h-[80%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Sep</div></div>
<div class="flex-1 bg-primary/80 rounded-t-sm h-[78%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Oct</div></div>
<div class="flex-1 bg-primary rounded-t-sm h-[85%] hover:bg-primary/50 transition-all relative group"><div class="hidden group-hover:block absolute -top-6 left-0 text-[10px] bg-black px-1 rounded">Nov</div></div>
<div class="flex-1 bg-white/20 rounded-t-sm h-[20%] border-t border-dashed border-white/40 flex items-center justify-center text-[9px] text-slate-300">Fcst</div>
</div>
<div class="flex justify-between mt-2 text-[10px] text-slate-500">
<span>Collections down 3.2% due to 14 delinquent units</span>
<span>Target: $1.4M</span>
</div>
</div>
</div>
<!-- Two Column Details -->
<div class="grid grid-cols-3 gap-6 px-6">
<!-- Work Orders Table (Span 2) -->
<div class="col-span-2 glass-panel rounded-lg overflow-hidden">
<div class="px-4 py-3 border-b border-border-dark flex justify-between items-center bg-surface-dark/50">
<h4 class="text-xs font-bold text-slate-200 uppercase tracking-wide">Active Work Orders</h4>
<button class="text-[10px] bg-primary text-white px-2 py-1 rounded hover:bg-primary/90 font-medium">+ Create WO</button>
</div>
<table class="w-full text-left text-xs">
<thead class="bg-surface-dark text-slate-400 font-medium border-b border-border-dark">
<tr>
<th class="px-4 py-2 font-medium">Task</th>
<th class="px-4 py-2 font-medium">Vendor</th>
<th class="px-4 py-2 font-medium text-right">Cost</th>
<th class="px-4 py-2 font-medium text-center">Status</th>
</tr>
</thead>
<tbody class="divide-y divide-white/5">
<tr class="hover:bg-white/5 group">
<td class="px-4 py-2.5">
<div class="font-medium text-white">Roof Repair - Bldg B</div>
<div class="text-[10px] text-slate-500">Priority: High • Due Tomorrow</div>
</td>
<td class="px-4 py-2.5 text-slate-300">Apex Roofing</td>
<td class="px-4 py-2.5 text-right font-mono text-slate-200">$12,500</td>
<td class="px-4 py-2.5 text-center">
<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">Approved</span>
</td>
</tr>
<tr class="hover:bg-white/5 group">
<td class="px-4 py-2.5">
<div class="font-medium text-white">HVAC Replace - Unit 402</div>
<div class="text-[10px] text-slate-500">Priority: Medium • Due Oct 24</div>
</td>
<td class="px-4 py-2.5 text-slate-300">CoolAir Pros</td>
<td class="px-4 py-2.5 text-right font-mono text-slate-200">$3,200</td>
<td class="px-4 py-2.5 text-center">
<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/10 text-warning border border-warning/20">Pending</span>
</td>
</tr>
<tr class="hover:bg-white/5 group">
<td class="px-4 py-2.5">
<div class="font-medium text-white">Lobby Painting</div>
<div class="text-[10px] text-slate-500">Priority: Low • Due Nov 01</div>
</td>
<td class="px-4 py-2.5 text-slate-300">ProPainters</td>
<td class="px-4 py-2.5 text-right font-mono text-slate-200">$1,800</td>
<td class="px-4 py-2.5 text-center">
<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-700 text-slate-300 border border-slate-600">Draft</span>
</td>
</tr>
</tbody>
</table>
</div>
<!-- Leasing / Unit Turns (Span 1) -->
<div class="col-span-1 glass-panel rounded-lg p-4 flex flex-col gap-4">
<div class="flex justify-between items-center">
<h4 class="text-xs font-bold text-slate-200 uppercase tracking-wide">Leasing</h4>
<span class="material-symbols-outlined text-slate-500 text-sm">open_in_new</span>
</div>
<div class="grid grid-cols-2 gap-3">
<div class="bg-surface-dark p-2 rounded border border-border-dark">
<span class="block text-[10px] text-slate-400">Vacant</span>
<span class="text-lg font-bold text-white">4</span>
</div>
<div class="bg-surface-dark p-2 rounded border border-border-dark">
<span class="block text-[10px] text-slate-400">In Turn</span>
<span class="text-lg font-bold text-warning">2</span>
</div>
</div>
<div class="space-y-2 pt-2 border-t border-white/5">
<div class="flex justify-between text-xs">
<span class="text-slate-400">Avg Turn Time</span>
<span class="font-mono text-white">14 days</span>
</div>
<div class="flex justify-between text-xs">
<span class="text-slate-400">Leads (Wk)</span>
<span class="font-mono text-white">12</span>
</div>
<div class="flex justify-between text-xs">
<span class="text-slate-400">Top Concession</span>
<span class="font-mono text-white">1 Mo Free</span>
</div>
</div>
<div class="bg-blue-500/10 border border-blue-500/20 p-2 rounded text-[10px] text-blue-200">
<strong>Note:</strong> Fall leasing special approved. Flyer distribution started.
                        </div>
</div>
</div>
</div>
<!-- Sticky Action Bar -->
<div class="absolute bottom-0 left-0 w-full glass-header border-t border-border-dark p-4 flex justify-between items-center backdrop-blur-xl z-50">
<div class="flex items-center gap-4">
<button class="flex items-center gap-1 text-xs font-medium text-danger hover:text-red-400 transition-colors">
<span class="material-symbols-outlined text-[16px]">warning</span> Escalate Issue
                     </button>
<div class="h-4 w-px bg-white/10"></div>
<span class="text-xs text-slate-500">Last save: 2 mins ago</span>
</div>
<div class="flex gap-3">
<button class="px-3 py-2 rounded-md bg-surface-dark border border-border-dark text-slate-200 text-xs font-medium hover:bg-white/5 transition-colors">Add Note</button>
<button class="px-3 py-2 rounded-md bg-surface-dark border border-border-dark text-slate-200 text-xs font-medium hover:bg-white/5 transition-colors flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]">picture_as_pdf</span> Status Report
                    </button>
<button class="px-4 py-2 rounded-md bg-primary text-white text-xs font-bold hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20">
                        Approve Offer / Next Step
                    </button>
</div>
</div>
</section>
<!-- RIGHT COLUMN: Disposition & Recovery -->
<aside class="w-[380px] flex flex-col border-l border-border-dark bg-[#111620] overflow-y-auto shrink-0 z-20 shadow-xl">
<div class="p-4 border-b border-border-dark bg-surface-dark/30">
<h3 class="text-xs font-bold uppercase tracking-wider text-slate-300 mb-4">Disposition &amp; Recovery</h3>
<!-- Pipeline Visual -->
<div class="relative flex justify-between items-center text-[9px] font-medium text-slate-500 mb-6">
<div class="absolute top-1/2 left-0 w-full h-1 bg-surface-dark rounded-full -z-0">
<div class="w-3/4 h-full bg-gradient-to-r from-primary/50 to-primary rounded-full"></div>
</div>
<div class="relative z-10 flex flex-col items-center gap-1"><div class="size-2 bg-primary rounded-full ring-4 ring-[#111620]"></div>BOV</div>
<div class="relative z-10 flex flex-col items-center gap-1"><div class="size-2 bg-primary rounded-full ring-4 ring-[#111620]"></div>Listed</div>
<div class="relative z-10 flex flex-col items-center gap-1"><div class="size-2 bg-primary rounded-full ring-4 ring-[#111620]"></div>Offers</div>
<div class="relative z-10 flex flex-col items-center gap-1"><div class="size-3 bg-white rounded-full ring-4 ring-[#111620] shadow-[0_0_8px_white]"></div><span class="text-white font-bold">Review</span></div>
<div class="relative z-10 flex flex-col items-center gap-1"><div class="size-2 bg-surface-dark border border-slate-600 rounded-full ring-4 ring-[#111620]"></div>Close</div>
</div>
<!-- Offers Mini Table -->
<div class="glass-panel rounded-lg overflow-hidden border border-white/10">
<table class="w-full text-left text-[10px]">
<thead class="bg-surface-dark/80 text-slate-400">
<tr>
<th class="px-3 py-2 font-medium">Buyer</th>
<th class="px-3 py-2 font-medium text-right">Offer</th>
<th class="px-3 py-2 font-medium text-right">Prob.</th>
<th class="px-3 py-2"></th>
</tr>
</thead>
<tbody class="divide-y divide-white/5">
<tr class="bg-primary/10">
<td class="px-3 py-2 font-medium text-white">BlackRock</td>
<td class="px-3 py-2 text-right font-mono text-white">$42.5M</td>
<td class="px-3 py-2 text-right text-success">High</td>
<td class="px-3 py-2 text-right"><button class="text-primary hover:underline">Review</button></td>
</tr>
<tr>
<td class="px-3 py-2 font-medium text-slate-300">Starwood</td>
<td class="px-3 py-2 text-right font-mono text-slate-300">$41.2M</td>
<td class="px-3 py-2 text-right text-warning">Med</td>
<td class="px-3 py-2 text-right"><button class="text-slate-500 hover:text-primary">Review</button></td>
</tr>
</tbody>
</table>
</div>
</div>
<div class="p-4 space-y-6">
<!-- Recovery Waterfall -->
<div class="glass-panel rounded-lg p-4 border border-border-dark relative overflow-hidden">
<div class="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
<span class="material-symbols-outlined text-6xl">account_balance</span>
</div>
<h4 class="text-xs font-bold text-slate-200 uppercase tracking-wide mb-3 flex items-center gap-2">
                        Recovery Model <span class="bg-green-500/10 text-green-400 text-[9px] px-1.5 rounded">Audit Grade</span>
</h4>
<div class="space-y-2 text-xs">
<div class="flex justify-between items-center text-slate-300">
<span>Gross Proceeds</span>
<span class="font-mono text-white">$42,500,000</span>
</div>
<div class="flex justify-between items-center text-slate-400">
<span>(-) Closing Costs (est)</span>
<span class="font-mono text-danger">($1,200,000)</span>
</div>
<div class="flex justify-between items-center text-slate-400">
<span>(-) Tax/Ins Arrears</span>
<span class="font-mono text-danger">($500,000)</span>
</div>
<div class="flex justify-between items-center text-slate-400 pb-2 border-b border-white/10">
<span>(-) Capex / Legal Fees</span>
<span class="font-mono text-danger">($350,000)</span>
</div>
<div class="flex justify-between items-center text-white font-bold pt-1 text-sm">
<span>Net Recovery</span>
<span class="font-mono">$40,450,000</span>
</div>
<div class="flex justify-between items-center text-[10px] text-slate-500 pt-2">
<span>% UPB Recovery</span>
<span class="font-mono text-success font-bold">91.2%</span>
</div>
</div>
<div class="mt-3 pt-2 border-t border-white/5 text-[9px] text-slate-600 flex justify-between">
<span>Model owner: S. Miller</span>
<span>As of: Today 10:00 AM</span>
</div>
</div>
<!-- Approvals & Governance -->
<div class="space-y-3">
<h4 class="text-xs font-bold text-slate-200 uppercase tracking-wide">Approvals &amp; Governance</h4>
<div class="space-y-2">
<!-- Approver 1 -->
<div class="flex items-center justify-between p-2 rounded bg-surface-dark/50 border border-border-dark/50">
<div class="flex items-center gap-3">
<div class="relative">
<div class="size-8 rounded-full bg-slate-700 bg-cover bg-center" data-alt="Approver 1" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuBgsLhriS5sxz5DrqUm6wLApcSP6grm07mMHsIAFLTStze-FMESe3YlMsmCNqWIqXa2oX3dDjm46bIJ3E50eE58GOl27lHaaFVxnQLL8aSJGd8ewsP1FFtOiFTjUXdCb8NxDkY7ilq3bjUizoKHDRnjcZfuxpK5SrxSaF0EOnovq9mneB8DPgxF0R6OujXRJRP-aVk_Ft3Y2GQ9aontl9gXVcNJu4fs9HP2yXJGzz0xtwJbA3fd1JUV4elGM3rSBjQkbDpJ8-ESG98');"></div>
<div class="absolute -bottom-1 -right-1 bg-background-dark rounded-full p-0.5">
<span class="material-symbols-outlined text-[14px] text-success bg-green-500/20 rounded-full">check_circle</span>
</div>
</div>
<div class="flex flex-col">
<span class="text-xs font-medium text-white">Head of Special Assets</span>
<span class="text-[9px] text-slate-500">Approved Oct 20</span>
</div>
</div>
</div>
<!-- Approver 2 -->
<div class="flex items-center justify-between p-2 rounded bg-surface-dark/50 border border-border-dark/50">
<div class="flex items-center gap-3">
<div class="relative">
<div class="size-8 rounded-full bg-slate-700 bg-cover bg-center" data-alt="Approver 2" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuAWsd5iOltkwtlJEpZPgRhv8I07LvSWAHZNOZ9FHjdTLoL-f8X2YCN4qAsOegTWDjL428uQun57U26YK2mI0Bh28T39dgXZ3mjJo45_okjsnGa-BYXFHiJwd_ejQXxyvRKzjenGss9oZAlWSPnJCe0ZTn_3pJMLzcAMLLGw5IH4R7CHdG3wosi1ig49mgJrAzCtHNYcIxPVuRQI8dC-wV8y7XcSvWyU0BMWQu9RUem2m8mR5HGK0zuXms1gHTbYnYWbYH_egBj74Yw');"></div>
<div class="absolute -bottom-1 -right-1 bg-background-dark rounded-full p-0.5">
<span class="material-symbols-outlined text-[14px] text-warning bg-warning/20 rounded-full">pending</span>
</div>
</div>
<div class="flex flex-col">
<span class="text-xs font-medium text-white">Chief Credit Officer</span>
<span class="text-[9px] text-warning">Pending Review</span>
</div>
</div>
<button class="text-[10px] text-primary hover:underline">Nudge</button>
</div>
<!-- Approver 3 -->
<div class="flex items-center justify-between p-2 rounded bg-surface-dark/50 border border-border-dark/50 opacity-60">
<div class="flex items-center gap-3">
<div class="relative">
<div class="size-8 rounded-full bg-slate-800 flex items-center justify-center border border-white/10">
<span class="text-[10px] text-slate-500">Legal</span>
</div>
</div>
<div class="flex flex-col">
<span class="text-xs font-medium text-white">Legal Counsel</span>
<span class="text-[9px] text-slate-500">Waiting on Credit</span>
</div>
</div>
</div>
</div>
</div>
<!-- Mini Audit Trail -->
<div class="pt-4 border-t border-white/5">
<h4 class="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Recent Activity</h4>
<ul class="space-y-3 relative border-l border-white/10 ml-1.5 pl-4">
<li class="relative">
<div class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-surface-dark border border-slate-600"></div>
<p class="text-[10px] text-slate-300">New offer received from BlackRock ($42.5M)</p>
<span class="text-[9px] text-slate-600">1 hour ago • J. Lin (Broker)</span>
</li>
<li class="relative">
<div class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-surface-dark border border-slate-600"></div>
<p class="text-[10px] text-slate-300">Stabilization budget adjusted (+5%)</p>
<span class="text-[9px] text-slate-600">Yesterday • System</span>
</li>
</ul>
</div>
</div>
</aside>
</main>`;

export default function Page() {
  redirect("/workout/reo");
  return null;
}
