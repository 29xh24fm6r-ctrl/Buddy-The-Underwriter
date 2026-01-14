import { redirect } from "next/navigation";

const TITLE = "Workout Legal Execution Tracker";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "background-light": "#f6f7f8",
                        "background-dark": "#101822",
                        "surface-dark": "#1c2027",
                        "border-dark": "#282f39",
                        "text-secondary": "#9da8b9",
                        "danger": "#ef4444",
                        "warning": "#f59e0b",
                        "success": "#10b981",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "sans": ["Inter", "sans-serif"],
                    },
                    borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
                },
            },
        }`;
const STYLES = [
  "/* Custom scrollbar for dense data panels */\n        ::-webkit-scrollbar {\n            width: 6px;\n            height: 6px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #111418; \n        }\n        ::-webkit-scrollbar-thumb {\n            background: #3b4554; \n            border-radius: 3px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #4b5563; \n        }\n        .glass-panel {\n            background: rgba(28, 32, 39, 0.7);\n            backdrop-filter: blur(10px);\n        }"
];
const BODY_HTML = `<!-- Global Header -->
<header class="flex-none flex items-center justify-between whitespace-nowrap border-b border-solid border-border-dark bg-[#111418] px-6 py-3 z-50">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3 text-white">
<div class="size-6 text-primary">
<span class="material-symbols-outlined text-[24px]">token</span>
</div>
<h2 class="text-white text-lg font-bold leading-tight tracking-[-0.015em]">Buddy</h2>
</div>
<!-- Global Search -->
<label class="hidden md:flex flex-col min-w-64 h-9">
<div class="flex w-full flex-1 items-stretch rounded-lg h-full bg-surface-dark border border-border-dark group-focus-within:border-primary">
<div class="text-text-secondary flex items-center justify-center pl-3">
<span class="material-symbols-outlined text-[20px]">search</span>
</div>
<input class="flex w-full min-w-0 flex-1 bg-transparent border-none text-white focus:ring-0 placeholder:text-text-secondary px-3 text-sm" placeholder="Global Search..."/>
</div>
</label>
</div>
<!-- Navigation -->
<nav class="hidden lg:flex flex-1 justify-center gap-6">
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Deals</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Intake</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Portfolio</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Committee</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Reporting</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Servicing</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Workout</a>
<a class="text-primary text-sm font-bold border-b-2 border-primary pb-0.5" href="#">Legal</a>
</nav>
<div class="flex items-center gap-4">
<div class="flex gap-2">
<button class="flex items-center justify-center rounded-lg size-9 bg-surface-dark hover:bg-border-dark text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">notifications</span>
</button>
<button class="flex items-center justify-center rounded-lg size-9 bg-surface-dark hover:bg-border-dark text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">settings</span>
</button>
</div>
<div class="bg-center bg-no-repeat bg-cover rounded-full size-9 border border-border-dark relative" data-alt="User avatar profile picture" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuAOiHiDpa-ZYJGV9NYaMiWicPiJPexbXnW-dEWlI5Q2WW-CI-6BuYk-oA4X2K9RtuSDRNSYgqZd9rxl_vKMb7QHa75h7Zm-mS_yAUn3dXbWcnl_ppfrJHiabFhe4ckWYoL9tsvVxBXomEfwEZMyYMktNJ_gTzSnAXa80e7YGlmwekNqjCFcw_y7VqC35QiLATSe9uyspz21jEXpa8x3K25t3N8yugd-5JYhZyDhzg5Gg53g5Y5dLw-sx6RSImxtWoSzwd8ouhS2JXo");'>
<div class="absolute bottom-0 right-0 size-2.5 bg-success rounded-full border-2 border-[#111418]"></div>
</div>
</div>
</header>
<!-- Main Command Bridge Layout -->
<main class="flex flex-1 overflow-hidden">
<!-- LEFT COLUMN: Case Selector + Filters -->
<aside class="flex flex-col w-[320px] border-r border-border-dark bg-[#0d1218] flex-none z-20">
<!-- Filter Card -->
<div class="p-4 border-b border-border-dark space-y-3">
<h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider">Case Selector</h3>
<div class="relative">
<span class="absolute left-3 top-2.5 text-text-secondary material-symbols-outlined text-[18px]">filter_list</span>
<input class="w-full bg-surface-dark border border-border-dark rounded-md py-2 pl-9 pr-3 text-sm text-white focus:outline-none focus:border-primary placeholder:text-text-secondary/60" placeholder="Search case, borrower..."/>
</div>
<div class="flex gap-2 flex-wrap">
<select class="bg-surface-dark border border-border-dark text-xs text-white rounded px-2 py-1.5 focus:outline-none flex-1 min-w-[80px]">
<option>Jurisdiction</option>
<option>MA</option>
<option>NY</option>
<option>CA</option>
</select>
<select class="bg-surface-dark border border-border-dark text-xs text-white rounded px-2 py-1.5 focus:outline-none flex-1 min-w-[80px]">
<option>Stage</option>
<option>Pre-Legal</option>
<option>Foreclosure</option>
</select>
</div>
</div>
<!-- Case List -->
<div class="flex-1 overflow-y-auto">
<!-- Case Item 1 (Active) -->
<div class="group cursor-pointer border-l-[3px] border-primary bg-primary/10 p-3 hover:bg-primary/5 transition-colors border-b border-border-dark">
<div class="flex justify-between items-start mb-1">
<span class="text-xs font-bold text-primary">CASE-98421</span>
<span class="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded border border-red-500/30">Active Legal</span>
</div>
<div class="text-sm font-semibold text-white truncate mb-1">Harbor View Multifamily</div>
<div class="flex items-center gap-2 mb-2">
<span class="text-[10px] text-text-secondary bg-surface-dark px-1.5 rounded">MA</span>
<span class="text-[10px] text-text-secondary bg-surface-dark px-1.5 rounded">Multifamily</span>
</div>
<div class="flex justify-between items-center text-xs">
<div class="flex items-center text-warning gap-1">
<span class="material-symbols-outlined text-[14px]">timer</span>
<span>2d 4h</span>
</div>
<div class="flex items-center gap-1 text-text-secondary">
<div class="size-5 rounded-full bg-gray-600 flex items-center justify-center text-[9px] text-white">LP</div>
</div>
</div>
</div>
<!-- Case Item 2 -->
<div class="group cursor-pointer border-l-[3px] border-transparent p-3 hover:bg-surface-dark transition-colors border-b border-border-dark">
<div class="flex justify-between items-start mb-1">
<span class="text-xs font-medium text-text-secondary group-hover:text-white">CASE-98102</span>
<span class="text-[10px] bg-border-dark text-text-secondary px-1.5 py-0.5 rounded border border-border-dark">Stayed</span>
</div>
<div class="text-sm font-medium text-text-secondary group-hover:text-white truncate mb-1">Apex Industrial Park</div>
<div class="flex items-center gap-2 mb-2">
<span class="text-[10px] text-text-secondary bg-surface-dark px-1.5 rounded">NV</span>
<span class="text-[10px] text-text-secondary bg-surface-dark px-1.5 rounded">Industrial</span>
</div>
<div class="flex justify-between items-center text-xs">
<div class="flex items-center text-text-secondary gap-1">
<span class="material-symbols-outlined text-[14px]">calendar_month</span>
<span>14d</span>
</div>
<div class="flex items-center gap-1 text-text-secondary">
<div class="size-5 rounded-full bg-gray-700 flex items-center justify-center text-[9px] text-white">MJ</div>
</div>
</div>
</div>
<!-- Case Item 3 -->
<div class="group cursor-pointer border-l-[3px] border-transparent p-3 hover:bg-surface-dark transition-colors border-b border-border-dark">
<div class="flex justify-between items-start mb-1">
<span class="text-xs font-medium text-text-secondary group-hover:text-white">CASE-96554</span>
<span class="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded border border-green-500/20">Closed</span>
</div>
<div class="text-sm font-medium text-text-secondary group-hover:text-white truncate mb-1">Skyline Office Tower</div>
<div class="flex items-center gap-2 mb-2">
<span class="text-[10px] text-text-secondary bg-surface-dark px-1.5 rounded">NY</span>
<span class="text-[10px] text-text-secondary bg-surface-dark px-1.5 rounded">Office</span>
</div>
<div class="flex justify-between items-center text-xs">
<div class="flex items-center text-text-secondary gap-1">
<span>--</span>
</div>
<div class="flex items-center gap-1 text-text-secondary">
<div class="size-5 rounded-full bg-gray-700 flex items-center justify-center text-[9px] text-white">DK</div>
</div>
</div>
</div>
<!-- Filler items for scroll -->
<div class="h-20"></div>
</div>
</aside>
<!-- CENTER COLUMN: Legal Execution Timeline (The Truth) -->
<section class="flex flex-col flex-1 min-w-0 bg-[#111418] relative z-10">
<!-- Selected Case Header -->
<div class="bg-surface-dark border-b border-border-dark p-4 shadow-sm">
<div class="flex justify-between items-start">
<div>
<div class="flex items-center gap-3 mb-1">
<h1 class="text-xl font-bold text-white">Harbor View Multifamily</h1>
<span class="text-xs text-text-secondary font-mono">CASE-98421</span>
<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">ENFORCEMENT STANDBY</span>
</div>
<div class="flex gap-6 text-xs text-text-secondary mt-2">
<div><span class="text-gray-500 block text-[10px] uppercase tracking-wide">Borrower</span>Harbor View Holdings LLC</div>
<div><span class="text-gray-500 block text-[10px] uppercase tracking-wide">Jurisdiction</span>Boston, MA (Suffolk Cty)</div>
<div><span class="text-gray-500 block text-[10px] uppercase tracking-wide">Counsel</span>Kirkland &amp; Ellis (Ext)</div>
<div><span class="text-gray-500 block text-[10px] uppercase tracking-wide">Maturity</span>Nov 12, 2023</div>
</div>
</div>
<div class="text-right">
<div class="inline-flex flex-col items-end">
<span class="text-[10px] uppercase text-text-secondary font-bold tracking-wide">Next Key Date</span>
<span class="text-2xl font-bold text-white tabular-nums">02<span class="text-sm text-text-secondary font-medium mx-1">d</span> 04<span class="text-sm text-text-secondary font-medium mx-1">h</span></span>
<span class="text-xs text-warning">Cure Period Ends</span>
</div>
</div>
</div>
</div>
<!-- Content Area: Radar + Timeline -->
<div class="flex-1 overflow-y-auto p-6 scroll-smooth">
<!-- Deadline Radar Strip -->
<div class="mb-6">
<h4 class="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3 flex items-center gap-2">
<span class="material-symbols-outlined text-[16px]">radar</span> Deadline Radar
                    </h4>
<div class="flex gap-4 overflow-x-auto pb-2">
<!-- Card 1: Critical -->
<div class="flex-none w-60 bg-surface-dark border border-l-4 border-l-danger border-y-border-dark border-r-border-dark rounded-r p-3 shadow-lg">
<div class="flex justify-between mb-2">
<span class="text-[10px] font-bold text-danger uppercase">Critical</span>
<span class="text-[10px] text-text-secondary">Owner: LP</span>
</div>
<div class="text-sm font-bold text-white mb-1">Cure Period Ends</div>
<div class="text-xs text-text-secondary mb-2">Oct 26, 5:00 PM ET</div>
<div class="w-full bg-gray-700 h-1 rounded-full overflow-hidden">
<div class="bg-danger h-full w-[85%]"></div>
</div>
</div>
<!-- Card 2: Warning -->
<div class="flex-none w-60 bg-surface-dark border border-l-4 border-l-warning border-y-border-dark border-r-border-dark rounded-r p-3 shadow-lg">
<div class="flex justify-between mb-2">
<span class="text-[10px] font-bold text-warning uppercase">Upcoming</span>
<span class="text-[10px] text-text-secondary">Owner: Ext</span>
</div>
<div class="text-sm font-bold text-white mb-1">File Motion for Relief</div>
<div class="text-xs text-text-secondary mb-2">Oct 30, 9:00 AM ET</div>
<div class="w-full bg-gray-700 h-1 rounded-full overflow-hidden">
<div class="bg-warning h-full w-[40%]"></div>
</div>
</div>
<!-- Card 3: Info -->
<div class="flex-none w-60 bg-surface-dark border border-l-4 border-l-primary border-y-border-dark border-r-border-dark rounded-r p-3 shadow-lg">
<div class="flex justify-between mb-2">
<span class="text-[10px] font-bold text-primary uppercase">Scheduled</span>
<span class="text-[10px] text-text-secondary">Owner: Court</span>
</div>
<div class="text-sm font-bold text-white mb-1">Hearing Date</div>
<div class="text-xs text-text-secondary mb-2">Nov 15, 2:00 PM ET</div>
<div class="w-full bg-gray-700 h-1 rounded-full overflow-hidden">
<div class="bg-primary h-full w-[10%]"></div>
</div>
</div>
</div>
</div>
<!-- Vertical Execution Timeline -->
<div class="mb-6">
<h4 class="text-xs font-bold text-text-secondary uppercase tracking-widest mb-4 flex items-center gap-2">
<span class="material-symbols-outlined text-[16px]">history_edu</span> Execution Log
                    </h4>
<div class="relative pl-4 space-y-8 ml-2 border-l-2 border-border-dark">
<!-- Step 1: Current -->
<div class="relative pl-6">
<div class="absolute -left-[23px] top-1 size-3 rounded-full bg-primary border-4 border-[#111418] ring-1 ring-primary"></div>
<div class="flex flex-col gap-2 p-4 rounded-lg bg-surface-dark border border-border-dark shadow-sm">
<div class="flex justify-between items-start">
<h5 class="text-sm font-bold text-white">Notice of Default (Sent)</h5>
<span class="text-[10px] font-medium text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded-full">Served</span>
</div>
<div class="text-xs text-text-secondary">
                                    Sent via Certified Mail &amp; Overnight Courier to all guarantors.
                                </div>
<div class="flex items-center gap-4 mt-1 border-t border-border-dark pt-2">
<div class="flex items-center gap-1 text-primary cursor-pointer hover:underline text-xs">
<span class="material-symbols-outlined text-[14px]">description</span>
                                        NoD_v2_Final_Signed.pdf
                                    </div>
<div class="flex items-center gap-1 text-text-secondary text-xs">
<span class="material-symbols-outlined text-[14px]">verified_user</span>
                                        L. Park
                                    </div>
<div class="text-[10px] text-text-secondary ml-auto">Oct 21, 14:32</div>
</div>
</div>
</div>
<!-- Step 2: Past -->
<div class="relative pl-6 opacity-70">
<div class="absolute -left-[23px] top-1 size-3 rounded-full bg-gray-600 border-4 border-[#111418] ring-1 ring-gray-600"></div>
<div class="flex flex-col gap-2 p-3 rounded-lg bg-surface-dark border border-border-dark">
<div class="flex justify-between items-start">
<h5 class="text-sm font-bold text-white">Demand Letter Drafted</h5>
<span class="text-[10px] font-medium text-gray-400 bg-gray-700/50 px-2 py-0.5 rounded-full">Completed</span>
</div>
<div class="flex items-center gap-4 mt-1">
<div class="flex items-center gap-1 text-text-secondary cursor-pointer hover:text-primary text-xs">
<span class="material-symbols-outlined text-[14px]">description</span>
                                        Demand_Letter_v1.4.pdf
                                    </div>
<div class="text-[10px] text-text-secondary ml-auto">Oct 18, 09:15</div>
</div>
</div>
</div>
<!-- Step 3: Past -->
<div class="relative pl-6 opacity-50">
<div class="absolute -left-[23px] top-1 size-3 rounded-full bg-gray-700 border-4 border-[#111418] ring-1 ring-gray-700"></div>
<div class="flex flex-col gap-2 p-3 rounded-lg bg-transparent border border-border-dark border-dashed">
<div class="flex justify-between items-start">
<h5 class="text-sm font-medium text-text-secondary">Maturity Default Triggered</h5>
</div>
<div class="text-[10px] text-text-secondary ml-auto">Oct 12, 00:00</div>
</div>
</div>
</div>
</div>
<!-- Embedded Kanban -->
<div>
<h4 class="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3 flex items-center gap-2">
<span class="material-symbols-outlined text-[16px]">view_kanban</span> Active Tasks
                    </h4>
<div class="grid grid-cols-3 gap-3">
<!-- Col 1 -->
<div class="bg-[#161b22] rounded-lg p-2 border border-border-dark">
<h6 class="text-[10px] font-bold text-text-secondary uppercase mb-2 pl-1">To Draft</h6>
<div class="bg-surface-dark p-2 rounded border border-border-dark mb-2 cursor-pointer hover:border-primary">
<div class="text-xs font-medium text-white mb-1">Draft Foreclosure Complaint</div>
<div class="flex justify-between items-center">
<span class="text-[9px] text-warning">Due: Oct 28</span>
<div class="size-4 rounded-full bg-primary flex items-center justify-center text-[8px]">LP</div>
</div>
</div>
</div>
<!-- Col 2 -->
<div class="bg-[#161b22] rounded-lg p-2 border border-border-dark">
<h6 class="text-[10px] font-bold text-text-secondary uppercase mb-2 pl-1">To File / Serve</h6>
<div class="bg-surface-dark p-2 rounded border border-border-dark mb-2 cursor-pointer hover:border-primary border-l-2 border-l-warning">
<div class="text-xs font-medium text-white mb-1">Serve Guarantor 2</div>
<div class="flex justify-between items-center">
<span class="text-[9px] text-danger font-bold">Overdue: 2h</span>
<div class="size-4 rounded-full bg-gray-600 flex items-center justify-center text-[8px]">KE</div>
</div>
</div>
</div>
<!-- Col 3 -->
<div class="bg-[#161b22] rounded-lg p-2 border border-border-dark">
<h6 class="text-[10px] font-bold text-text-secondary uppercase mb-2 pl-1">Waiting / External</h6>
<div class="bg-surface-dark p-2 rounded border border-border-dark mb-2 opacity-70">
<div class="text-xs font-medium text-white mb-1">Receive Title Report Update</div>
<div class="flex justify-between items-center">
<span class="text-[9px] text-text-secondary">Title Co.</span>
</div>
</div>
</div>
</div>
</div>
<!-- Spacer for action bar -->
<div class="h-20"></div>
</div>
</section>
<!-- RIGHT COLUMN: Docs, Counsel, Controls -->
<aside class="flex flex-col w-[360px] border-l border-border-dark bg-[#0d1218] flex-none z-20 relative">
<div class="flex-1 overflow-y-auto p-4 space-y-6">
<!-- Document Control Panel -->
<section>
<div class="flex items-center justify-between mb-3">
<h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider">Document Control</h3>
<button class="text-primary hover:text-white text-xs font-medium">View All</button>
</div>
<div class="bg-surface-dark rounded-lg border border-border-dark divide-y divide-border-dark">
<!-- Doc Item -->
<div class="p-3 hover:bg-[#232933] transition-colors group">
<div class="flex items-center justify-between mb-1">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-primary text-[18px]">article</span>
<span class="text-xs font-semibold text-white">Notice of Default</span>
</div>
<span class="text-[9px] bg-green-500/20 text-green-400 px-1.5 rounded border border-green-500/30">v2.0 Final</span>
</div>
<div class="flex justify-between items-center text-[10px] text-text-secondary pl-6">
<span>Updated 2d ago by L. Park</span>
<span class="material-symbols-outlined text-[14px] cursor-pointer hover:text-primary">open_in_new</span>
</div>
</div>
<!-- Doc Item -->
<div class="p-3 hover:bg-[#232933] transition-colors group">
<div class="flex items-center justify-between mb-1">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-warning text-[18px]">text_snippet</span>
<span class="text-xs font-semibold text-white">Demand Letter</span>
</div>
<span class="text-[9px] bg-warning/20 text-warning px-1.5 rounded border border-warning/30">v1.4 Review</span>
</div>
<div class="flex justify-between items-center text-[10px] text-text-secondary pl-6">
<span>Updated 5h ago by External</span>
<span class="material-symbols-outlined text-[14px] cursor-pointer hover:text-primary">open_in_new</span>
</div>
</div>
<!-- Doc Item -->
<div class="p-3 hover:bg-[#232933] transition-colors group opacity-70">
<div class="flex items-center justify-between mb-1">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-text-secondary text-[18px]">draft</span>
<span class="text-xs font-semibold text-text-secondary">Forbearance Agmt</span>
</div>
<span class="text-[9px] bg-border-dark text-text-secondary px-1.5 rounded">v0.1 Draft</span>
</div>
<div class="flex justify-between items-center text-[10px] text-text-secondary pl-6">
<span>Created 1w ago</span>
</div>
</div>
</div>
</section>
<!-- Counsel Snapshot -->
<section>
<h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">Counsel &amp; Billing</h3>
<div class="bg-surface-dark rounded-lg border border-border-dark p-3">
<div class="flex items-center gap-3 mb-3 pb-3 border-b border-border-dark">
<div class="size-8 rounded bg-white flex items-center justify-center text-black font-bold text-xs" data-alt="Kirkland Ellis Logo">KE</div>
<div>
<div class="text-xs font-bold text-white">Kirkland &amp; Ellis LLP</div>
<div class="text-[10px] text-text-secondary">Lead: Michael Ross (Partner)</div>
</div>
<button class="ml-auto text-[10px] text-primary border border-border-dark hover:bg-border-dark px-2 py-1 rounded">Update</button>
</div>
<div class="grid grid-cols-2 gap-2 text-center">
<div class="bg-[#111418] rounded p-2">
<span class="block text-[9px] text-text-secondary uppercase">Budget (YTD)</span>
<span class="block text-xs font-bold text-white">$45,000</span>
</div>
<div class="bg-[#111418] rounded p-2 relative overflow-hidden">
<div class="absolute bottom-0 left-0 h-0.5 bg-warning w-[78%]"></div>
<span class="block text-[9px] text-text-secondary uppercase">Actual</span>
<span class="block text-xs font-bold text-warning">$35,210</span>
</div>
</div>
</div>
</section>
<!-- Jurisdiction / Risk -->
<section class="space-y-4">
<!-- Guardrails -->
<div>
<h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">MA Jurisdiction Rules</h3>
<ul class="text-[11px] text-text-secondary space-y-2 bg-surface-dark p-3 rounded-lg border border-border-dark">
<li class="flex items-start gap-2">
<span class="material-symbols-outlined text-success text-[14px]">check_circle</span>
<span>90-Day Right to Cure (Res/Multi)</span>
</li>
<li class="flex items-start gap-2">
<span class="material-symbols-outlined text-success text-[14px]">check_circle</span>
<span>Service via Sheriff Required</span>
</li>
<li class="flex items-start gap-2">
<span class="material-symbols-outlined text-text-secondary text-[14px]">info</span>
<span>Soldiers &amp; Sailors Relief Act Check</span>
</li>
</ul>
</div>
<!-- Risk Flags -->
<div class="p-3 rounded-lg bg-danger/10 border border-danger/30">
<div class="flex items-center gap-2 mb-2">
<span class="material-symbols-outlined text-danger text-[18px]">warning</span>
<span class="text-xs font-bold text-danger">Risk Flags Detected</span>
</div>
<div class="flex flex-wrap gap-2">
<span class="px-2 py-1 bg-[#111418] text-white text-[10px] rounded border border-danger/40">Borrower Counsel Engaged</span>
<span class="px-2 py-1 bg-[#111418] text-white text-[10px] rounded border border-danger/40">Litigation Pending</span>
</div>
</div>
</section>
<!-- Spacer for action bar -->
<div class="h-32"></div>
</div>
<!-- Sticky Action Bar -->
<div class="absolute bottom-0 w-full bg-[#111418]/95 backdrop-blur border-t border-border-dark p-4 space-y-3 shadow-2xl">
<button class="w-full flex items-center justify-center gap-2 bg-primary hover:bg-blue-600 text-white font-bold text-sm h-10 rounded-md transition-all shadow-[0_0_15px_rgba(19,109,236,0.3)]">
<span class="material-symbols-outlined text-[18px]">bolt</span>
                    Generate Next Notice
                </button>
<div class="grid grid-cols-2 gap-2">
<button class="flex items-center justify-center gap-1 bg-surface-dark border border-border-dark hover:bg-border-dark text-white text-xs font-medium h-9 rounded-md transition-colors">
<span class="material-symbols-outlined text-[16px]">folder_zip</span>
                        Filing Packet
                    </button>
<button class="flex items-center justify-center gap-1 bg-surface-dark border border-border-dark hover:bg-border-dark text-white text-xs font-medium h-9 rounded-md transition-colors">
<span class="material-symbols-outlined text-[16px]">event</span>
                        Hearing Prep
                    </button>
</div>
<button class="w-full flex items-center justify-center gap-2 text-danger hover:bg-danger/10 text-xs font-bold h-8 rounded-md transition-colors uppercase tracking-wide">
                     Trigger Enforcement Path
                </button>
</div>
</aside>
</main>`;

export default function Page() {
  redirect("/deals");
  return null;
}
