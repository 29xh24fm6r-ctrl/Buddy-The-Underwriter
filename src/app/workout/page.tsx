import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Workout Command Center - Special Assets";
const FONT_LINKS = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `</script>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        primary: "#136dec",
                        "primary-dark": "#0b4cb4",
                        "background-light": "#f6f7f8",
                        "background-dark": "#0f1115", // Deep slate/black
                        "panel-dark": "#181b21", // Slightly lighter for panels
                        "panel-border": "#282f39",
                        "text-secondary": "#9da8b9",
                        "danger": "#ef4444",
                        "warning": "#f59e0b",
                        "success": "#10b981",
                    },
                    fontFamily: {
                        display: ["Inter", "sans-serif"],
                        mono: ["JetBrains Mono", "monospace"],
                    },
                    boxShadow: {
                        'glow': '0 0 20px -5px rgba(19, 109, 236, 0.3)',
                    }
                },
            },
        }`;
const STYLES = [
  "body {\n            font-family: 'Inter', sans-serif;\n            background-color: #0f1115;\n            color: #ffffff;\n            overflow: hidden; /* Prevent body scroll, layout handles it */\n        }\n        \n        /* Custom Scrollbar for dark theme */\n        ::-webkit-scrollbar {\n            width: 6px;\n            height: 6px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #181b21; \n        }\n        ::-webkit-scrollbar-thumb {\n            background: #3b4554; \n            border-radius: 3px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #4b5563; \n        }\n\n        .glass-panel {\n            background: rgba(24, 27, 33, 0.85);\n            backdrop-filter: blur(12px);\n            -webkit-backdrop-filter: blur(12px);\n        }\n\n        .hide-scrollbar::-webkit-scrollbar {\n            display: none;\n        }\n        .hide-scrollbar {\n            -ms-overflow-style: none;\n            scrollbar-width: none;\n        }"
];
const BODY_HTML = `<!-- Top Navigation (Reused & Adapted) -->
<header class="flex-none flex items-center justify-between whitespace-nowrap border-b border-solid border-panel-border bg-[#111418] px-6 py-3 z-50">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3 text-white">
<div class="size-6 text-primary">
<svg class="w-full h-full" fill="none" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<path clip-rule="evenodd" d="M24 0.757355L47.2426 24L24 47.2426L0.757355 24L24 0.757355ZM21 35.7574V12.2426L9.24264 24L21 35.7574Z" fill="currentColor" fill-rule="evenodd"></path>
</svg>
</div>
<h2 class="text-white text-lg font-bold tracking-tight">Buddy <span class="text-text-secondary font-normal text-sm ml-2 opacity-60">| Workout Command</span></h2>
</div>
<nav class="hidden md:flex items-center gap-6">
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Deals</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Intake</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Portfolio</a>
<a class="text-white text-sm font-medium transition-colors border-b-2 border-primary pb-4 -mb-4" href="#">Workouts</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Committee</a>
<a class="text-text-secondary hover:text-white text-sm font-medium transition-colors" href="#">Reporting</a>
</nav>
</div>
<div class="flex items-center gap-4">
<div class="relative hidden lg:flex items-center bg-[#282f39] rounded-lg h-9 w-64 border border-[#3b4554] focus-within:border-primary transition-colors">
<span class="material-symbols-outlined text-text-secondary pl-3 text-[20px]">search</span>
<input class="bg-transparent border-none text-white text-sm w-full focus:ring-0 placeholder:text-text-secondary" placeholder="Search loans, sponsors..."/>
<span class="text-xs text-text-secondary pr-3 font-mono">⌘K</span>
</div>
<button class="relative text-text-secondary hover:text-white transition-colors">
<span class="material-symbols-outlined">notifications</span>
<span class="absolute top-0 right-0 size-2 bg-danger rounded-full border-2 border-[#111418]"></span>
</button>
<div class="size-8 bg-center bg-cover rounded-full border border-[#3b4554]" data-alt="User Avatar" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuDDGxUCGmkt_ePLzOdS9aWM9_v2DxK-KA7xGri1x2AWj3r3ppc-HLpWnUKu6wZvDzfaBtbY4zvwOPlUSnWPxpnZuWgaR6uFOHq35E_XG3bsgYqRS3JORqKwWHFG_hB97fKvKU06AblzprnlY0-mr6-duYamHSQCTKWGbeMudyBFON4mQsf1bXiO8bmMuLS-NT2Z0GSbfOgqL5TF7wdXTEl8-_0CZdaPoVuJ5zC8OSyz6Y19tR_3EEdtQTg8AxeIiYIL5O-onsYvIDg');"></div>
</div>
</header>
<!-- Main Content Area: 3-Panel Layout -->
<main class="flex-1 flex overflow-hidden w-full relative">
<!-- LEFT PANE: Cases / Loans Queue -->
<aside class="w-[380px] flex-none flex flex-col border-r border-panel-border bg-[#13161b]">
<!-- Queue Header -->
<div class="flex-none p-4 border-b border-panel-border">
<div class="flex items-center justify-between mb-4">
<h3 class="text-sm font-semibold uppercase tracking-wider text-text-secondary">Active Cases</h3>
<div class="flex gap-2">
<button class="p-1 hover:bg-[#282f39] rounded text-text-secondary hover:text-white"><span class="material-symbols-outlined text-[18px]">filter_list</span></button>
<button class="p-1 hover:bg-[#282f39] rounded text-text-secondary hover:text-white"><span class="material-symbols-outlined text-[18px]">sort</span></button>
</div>
</div>
<!-- Queue Tabs -->
<div class="flex gap-4 border-b border-[#3b4554] mb-3 overflow-x-auto hide-scrollbar">
<button class="pb-2 text-sm font-medium text-white border-b-2 border-white whitespace-nowrap">My Queue (8)</button>
<button class="pb-2 text-sm font-medium text-text-secondary hover:text-white border-b-2 border-transparent hover:border-[#3b4554] whitespace-nowrap">Watchlist</button>
<button class="pb-2 text-sm font-medium text-text-secondary hover:text-white border-b-2 border-transparent hover:border-[#3b4554] whitespace-nowrap">REO</button>
<button class="pb-2 text-sm font-medium text-text-secondary hover:text-white border-b-2 border-transparent hover:border-[#3b4554] whitespace-nowrap">Closed</button>
</div>
<!-- Quick Filters -->
<div class="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
<span class="px-2 py-1 rounded bg-[#282f39] text-xs text-white border border-[#3b4554] whitespace-nowrap flex items-center gap-1">
                        Critical <span class="size-1.5 rounded-full bg-danger"></span>
</span>
<span class="px-2 py-1 rounded bg-[#282f39] text-xs text-text-secondary border border-[#3b4554] whitespace-nowrap">Maturity &lt; 90d</span>
<span class="px-2 py-1 rounded bg-[#282f39] text-xs text-text-secondary border border-[#3b4554] whitespace-nowrap">Retail</span>
</div>
</div>
<!-- Queue List -->
<div class="flex-1 overflow-y-auto">
<!-- Selected Item -->
<div class="group relative p-4 border-b border-panel-border bg-[#1c222b] cursor-pointer hover:bg-[#232933] transition-colors border-l-4 border-l-primary">
<div class="flex justify-between items-start mb-1">
<span class="text-xs font-bold text-primary uppercase tracking-wide">Highland Park Retail</span>
<span class="text-xs font-mono text-text-secondary">35 DPD</span>
</div>
<div class="flex justify-between items-center mb-2">
<h4 class="text-white font-medium text-sm">Highland Park Center</h4>
<span class="text-xs bg-[#282f39] text-white px-1.5 py-0.5 rounded border border-[#3b4554]">$12.4M</span>
</div>
<div class="flex flex-wrap gap-2 mb-2">
<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-danger/20 text-danger border border-danger/30">Payment Default</span>
<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-danger/20 text-danger border border-danger/30">Critical</span>
</div>
<div class="flex items-center justify-between mt-2">
<div class="flex items-center gap-1 text-[11px] text-text-secondary">
<span class="material-symbols-outlined text-[14px]">event_busy</span>
<span>Forbearance Exp 12d</span>
</div>
<div class="size-5 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center font-bold">BU</div>
</div>
</div>
<!-- Item 2 -->
<div class="group relative p-4 border-b border-panel-border cursor-pointer hover:bg-[#1c222b] transition-colors border-l-4 border-l-transparent hover:border-l-[#3b4554]">
<div class="flex justify-between items-start mb-1">
<span class="text-xs font-bold text-text-secondary uppercase tracking-wide">Riverdale Logistics</span>
<span class="text-xs font-mono text-text-secondary">5 DPD</span>
</div>
<div class="flex justify-between items-center mb-2">
<h4 class="text-text-secondary group-hover:text-white font-medium text-sm">Riverdale Logistics Ctr</h4>
<span class="text-xs bg-[#111418] text-text-secondary px-1.5 py-0.5 rounded border border-[#282f39]">$8.2M</span>
</div>
<div class="flex flex-wrap gap-2 mb-2">
<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/20 text-warning border border-warning/30">Covenant</span>
<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/20 text-warning border border-warning/30">High</span>
</div>
<div class="flex items-center justify-between mt-2">
<div class="flex items-center gap-1 text-[11px] text-text-secondary">
<span class="material-symbols-outlined text-[14px]">assignment_late</span>
<span>Appraisal Due 2d</span>
</div>
<div class="size-5 rounded-full bg-[#282f39] text-text-secondary text-[10px] flex items-center justify-center font-bold">JD</div>
</div>
</div>
<!-- Item 3 -->
<div class="group relative p-4 border-b border-panel-border cursor-pointer hover:bg-[#1c222b] transition-colors border-l-4 border-l-transparent hover:border-l-[#3b4554]">
<div class="flex justify-between items-start mb-1">
<span class="text-xs font-bold text-text-secondary uppercase tracking-wide">Oakwood Multifamily</span>
<span class="text-xs font-mono text-text-secondary">Current</span>
</div>
<div class="flex justify-between items-center mb-2">
<h4 class="text-text-secondary group-hover:text-white font-medium text-sm">Oakwood Heights</h4>
<span class="text-xs bg-[#111418] text-text-secondary px-1.5 py-0.5 rounded border border-[#282f39]">$22.1M</span>
</div>
<div class="flex flex-wrap gap-2 mb-2">
<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/20 text-primary border border-primary/30">Maturity Risk</span>
</div>
<div class="flex items-center justify-between mt-2">
<div class="flex items-center gap-1 text-[11px] text-text-secondary">
<span class="material-symbols-outlined text-[14px]">schedule</span>
<span>Refi Deadline 45d</span>
</div>
<div class="size-5 rounded-full bg-[#282f39] text-text-secondary text-[10px] flex items-center justify-center font-bold">AM</div>
</div>
</div>
</div>
</aside>
<!-- CENTER PANE: Strategy & Timeline -->
<section class="flex-1 flex flex-col min-w-0 bg-background-dark overflow-y-auto">
<!-- Case Header -->
<div class="p-6 pb-2">
<div class="flex justify-between items-start mb-6">
<div>
<div class="flex items-center gap-3 mb-1">
<h1 class="text-2xl font-bold text-white tracking-tight">Highland Park Retail Center</h1>
<span class="px-2 py-0.5 rounded text-xs font-bold bg-danger text-white uppercase tracking-wider">Default</span>
</div>
<div class="flex items-center gap-4 text-sm text-text-secondary">
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">location_on</span> Dallas, TX</span>
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">apartment</span> Retail (Grocery Anchored)</span>
<a class="text-primary hover:underline flex items-center gap-1" href="#">Highland Capital Group <span class="material-symbols-outlined text-[14px]">open_in_new</span></a>
</div>
</div>
<div class="flex items-center gap-2">
<div class="text-right">
<div class="text-xs text-text-secondary uppercase">Exposure</div>
<div class="text-xl font-mono font-bold text-white">$12,450,000</div>
</div>
<div class="h-8 w-px bg-panel-border mx-2"></div>
<div class="text-right">
<div class="text-xs text-text-secondary uppercase">Current LTV</div>
<div class="text-xl font-mono font-bold text-warning">82%</div>
</div>
</div>
</div>
<!-- Stepper -->
<div class="w-full mb-6">
<div class="flex items-center justify-between relative">
<div class="absolute top-1/2 left-0 w-full h-0.5 bg-[#282f39] -z-0"></div>
<!-- Completed Step -->
<div class="relative z-10 flex flex-col items-center gap-2 group">
<div class="size-6 rounded-full bg-primary text-white flex items-center justify-center border-2 border-background-dark">
<span class="material-symbols-outlined text-[14px]">check</span>
</div>
<span class="text-[10px] font-medium text-primary uppercase tracking-wider">Triage</span>
</div>
<!-- Current Step -->
<div class="relative z-10 flex flex-col items-center gap-2 group">
<div class="size-6 rounded-full bg-background-dark border-2 border-primary text-primary flex items-center justify-center shadow-[0_0_10px_rgba(19,109,236,0.5)]">
<div class="size-2 rounded-full bg-primary"></div>
</div>
<span class="text-[10px] font-bold text-white uppercase tracking-wider">Forbearance</span>
</div>
<!-- Future Steps -->
<div class="relative z-10 flex flex-col items-center gap-2 opacity-40">
<div class="size-6 rounded-full bg-[#282f39] border-2 border-background-dark text-text-secondary flex items-center justify-center">
<span class="text-[10px]">3</span>
</div>
<span class="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Modification</span>
</div>
<div class="relative z-10 flex flex-col items-center gap-2 opacity-40">
<div class="size-6 rounded-full bg-[#282f39] border-2 border-background-dark text-text-secondary flex items-center justify-center">
<span class="text-[10px]">4</span>
</div>
<span class="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Enforcement</span>
</div>
<div class="relative z-10 flex flex-col items-center gap-2 opacity-40">
<div class="size-6 rounded-full bg-[#282f39] border-2 border-background-dark text-text-secondary flex items-center justify-center">
<span class="text-[10px]">5</span>
</div>
<span class="text-[10px] font-medium text-text-secondary uppercase tracking-wider">REO</span>
</div>
<div class="relative z-10 flex flex-col items-center gap-2 opacity-40">
<div class="size-6 rounded-full bg-[#282f39] border-2 border-background-dark text-text-secondary flex items-center justify-center">
<span class="text-[10px]">6</span>
</div>
<span class="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Resolution</span>
</div>
</div>
</div>
<!-- Case Thesis -->
<div class="bg-panel-dark border border-panel-border rounded-lg p-4 mb-6 relative overflow-hidden">
<div class="absolute left-0 top-0 bottom-0 w-1 bg-warning"></div>
<div class="flex justify-between items-start mb-2">
<h4 class="text-sm font-bold text-white uppercase tracking-wide">Case Thesis</h4>
<span class="text-xs text-text-secondary">Last updated: 2h ago by B. Underwriter</span>
</div>
<p class="text-sm text-gray-300 leading-relaxed">
                        Sponsor requesting 6mo forbearance due to anchor tenant bankruptcy (Healthy Grocer). Cash flow constrained (DSCR 0.85x) but property value remains stable. Sponsor has committed $500k fresh equity for TI/LCs to backfill space. Strategy is to bridge to new lease.
                    </p>
<div class="flex gap-2 mt-3">
<span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-[#282f39] text-text-secondary border border-[#3b4554]">Anchor Tenant Risk</span>
<span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-[#282f39] text-text-secondary border border-[#3b4554]">Cash Flow Constraint</span>
</div>
</div>
<!-- Strategy & Actions -->
<div class="grid grid-cols-2 gap-6">
<!-- Next Best Actions -->
<div>
<div class="flex items-center justify-between mb-3">
<h4 class="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
<span class="material-symbols-outlined text-primary text-[18px]">bolt</span> Next Actions
                            </h4>
<button class="text-xs text-primary hover:text-primary-light font-medium">+ Add Action</button>
</div>
<div class="space-y-2">
<div class="flex items-center justify-between p-3 bg-panel-dark border border-primary/40 rounded-lg shadow-glow">
<div class="flex items-center gap-3">
<div class="size-5 rounded border border-primary/50 flex items-center justify-center text-primary">
<!-- Checkbox unselected -->
</div>
<div>
<p class="text-sm font-medium text-white">Review Updated Rent Roll</p>
<p class="text-xs text-text-secondary">Assigned to: <span class="text-white">Buddy U.</span></p>
</div>
</div>
<span class="text-xs font-bold text-danger bg-danger/10 px-2 py-1 rounded border border-danger/20">Due Today</span>
</div>
<div class="flex items-center justify-between p-3 bg-panel-dark border border-panel-border rounded-lg">
<div class="flex items-center gap-3">
<div class="size-5 rounded border border-[#3b4554] flex items-center justify-center"></div>
<div>
<p class="text-sm font-medium text-text-secondary">Order Updated Appraisal</p>
<p class="text-xs text-text-secondary">Assigned to: <span class="text-white">Analyst Team</span></p>
</div>
</div>
<span class="text-xs font-medium text-text-secondary">Due in 2d</span>
</div>
<div class="flex items-center justify-between p-3 bg-panel-dark border border-panel-border rounded-lg">
<div class="flex items-center gap-3">
<div class="size-5 rounded border border-[#3b4554] flex items-center justify-center"></div>
<div>
<p class="text-sm font-medium text-text-secondary">Draft Forbearance Agreement</p>
<p class="text-xs text-text-secondary">Assigned to: <span class="text-white">Legal</span></p>
</div>
</div>
<span class="text-xs font-medium text-text-secondary">Due in 5d</span>
</div>
</div>
</div>
<!-- Milestones Timeline -->
<div>
<div class="flex items-center justify-between mb-3">
<h4 class="text-sm font-bold text-white uppercase tracking-wide">Timeline Audit</h4>
<button class="text-xs text-text-secondary hover:text-white">View Full</button>
</div>
<div class="relative pl-4 border-l border-[#282f39] space-y-6">
<div class="relative">
<div class="absolute -left-[21px] top-1 size-3 rounded-full bg-primary border-2 border-background-dark"></div>
<p class="text-xs text-text-secondary mb-0.5">Today, 9:30 AM</p>
<p class="text-sm text-white">Sponsor submitted Q3 financials.</p>
</div>
<div class="relative">
<div class="absolute -left-[21px] top-1 size-3 rounded-full bg-[#3b4554] border-2 border-background-dark"></div>
<p class="text-xs text-text-secondary mb-0.5">Oct 24, 2:00 PM</p>
<p class="text-sm text-text-secondary">Default Notice sent via Certified Mail.</p>
</div>
<div class="relative">
<div class="absolute -left-[21px] top-1 size-3 rounded-full bg-[#3b4554] border-2 border-background-dark"></div>
<p class="text-xs text-text-secondary mb-0.5">Oct 15, 10:00 AM</p>
<p class="text-sm text-text-secondary">Payment missed. Grace period started.</p>
</div>
</div>
</div>
</div>
<!-- Documents Grid -->
<div class="mt-6 mb-24">
<h4 class="text-sm font-bold text-white uppercase tracking-wide mb-3">Key Evidence &amp; Docs</h4>
<div class="grid grid-cols-4 gap-3">
<div class="bg-panel-dark border border-panel-border hover:border-primary p-3 rounded-lg cursor-pointer transition-colors group">
<div class="flex items-center gap-2 mb-2">
<span class="material-symbols-outlined text-danger text-[20px]">picture_as_pdf</span>
<span class="text-xs font-bold text-white truncate">Note.pdf</span>
</div>
<p class="text-[10px] text-text-secondary">Added 12 Jan 2021</p>
</div>
<div class="bg-panel-dark border border-panel-border hover:border-primary p-3 rounded-lg cursor-pointer transition-colors group">
<div class="flex items-center gap-2 mb-2">
<span class="material-symbols-outlined text-primary text-[20px]">article</span>
<span class="text-xs font-bold text-white truncate">Term Sheet v2.docx</span>
</div>
<p class="text-[10px] text-text-secondary">Added Yesterday</p>
</div>
<div class="bg-panel-dark border border-panel-border hover:border-primary p-3 rounded-lg cursor-pointer transition-colors group">
<div class="flex items-center gap-2 mb-2">
<span class="material-symbols-outlined text-success text-[20px]">table_view</span>
<span class="text-xs font-bold text-white truncate">Rent Roll_Q3.xlsx</span>
</div>
<p class="text-[10px] text-text-secondary">Added Today</p>
</div>
<div class="bg-panel-dark border border-dashed border-panel-border hover:border-text-secondary p-3 rounded-lg cursor-pointer flex items-center justify-center gap-2 text-text-secondary hover:text-white transition-colors">
<span class="material-symbols-outlined text-[18px]">upload</span>
<span class="text-xs font-medium">Upload</span>
</div>
</div>
</div>
</div>
</section>
<!-- RIGHT PANE: Decision Cockpit -->
<aside class="w-[420px] flex-none flex flex-col border-l border-panel-border bg-[#13161b] overflow-y-auto pb-20">
<div class="p-4 border-b border-panel-border">
<h3 class="text-sm font-semibold uppercase tracking-wider text-text-secondary mb-4">Decision Cockpit</h3>
<!-- Materiality Summary -->
<div class="grid grid-cols-2 gap-3 mb-6">
<div class="bg-panel-dark p-3 rounded-lg border border-panel-border">
<p class="text-[10px] font-medium text-text-secondary uppercase">Exposure at Risk</p>
<p class="text-lg font-bold text-white mt-1">$12.4M</p>
<div class="w-full bg-[#282f39] h-1 mt-2 rounded-full overflow-hidden">
<div class="bg-danger w-full h-full"></div>
</div>
</div>
<div class="bg-panel-dark p-3 rounded-lg border border-panel-border">
<p class="text-[10px] font-medium text-text-secondary uppercase">Loss Severity Est.</p>
<p class="text-lg font-bold text-white mt-1">15 - 20%</p>
<div class="w-full bg-[#282f39] h-1 mt-2 rounded-full overflow-hidden">
<div class="bg-warning w-[20%] h-full ml-0"></div>
</div>
</div>
<div class="bg-panel-dark p-3 rounded-lg border border-panel-border">
<p class="text-[10px] font-medium text-text-secondary uppercase">Cure Probability</p>
<p class="text-lg font-bold text-success mt-1">65%</p>
<div class="w-full bg-[#282f39] h-1 mt-2 rounded-full overflow-hidden">
<div class="bg-success w-[65%] h-full"></div>
</div>
</div>
<div class="bg-panel-dark p-3 rounded-lg border border-panel-border">
<p class="text-[10px] font-medium text-text-secondary uppercase">Snapshot Delta</p>
<p class="text-lg font-bold text-warning mt-1">-5.2% Val</p>
<p class="text-[10px] text-text-secondary mt-1">vs Last Month</p>
</div>
</div>
<!-- Resolution Options Comparison -->
<div class="mb-6">
<h4 class="text-xs font-bold text-text-secondary uppercase tracking-wide mb-3">Resolution Options Analysis</h4>
<div class="space-y-3">
<!-- Option 1: Forbearance (Selected) -->
<div class="p-3 bg-panel-dark border-2 border-primary/50 rounded-lg relative overflow-hidden group">
<div class="absolute right-0 top-0 bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-bl">RECOMMENDED</div>
<div class="flex justify-between items-center mb-2">
<h5 class="text-sm font-bold text-white">1. Forbearance + Cure</h5>
<span class="text-xs font-bold text-success">High Recovery</span>
</div>
<div class="grid grid-cols-2 gap-y-2 gap-x-4 text-xs text-text-secondary mb-3">
<div><span class="block text-[10px] uppercase opacity-70">Timeline</span>3-6 Months</div>
<div><span class="block text-[10px] uppercase opacity-70">Complexity</span>Low</div>
</div>
<div class="w-full bg-[#282f39] rounded p-2 text-[11px] text-gray-300">
<span class="text-primary font-bold">Pros:</span> Retains sponsor equity, avoids foreclosure costs.
                            </div>
</div>
<!-- Option 2: Enforcement -->
<div class="p-3 bg-panel-dark border border-panel-border hover:border-text-secondary/50 rounded-lg opacity-80 hover:opacity-100 transition-all">
<div class="flex justify-between items-center mb-2">
<h5 class="text-sm font-bold text-text-secondary">2. Enforcement / FC</h5>
<span class="text-xs font-bold text-danger">Low Recovery</span>
</div>
<div class="grid grid-cols-2 gap-y-2 gap-x-4 text-xs text-text-secondary">
<div><span class="block text-[10px] uppercase opacity-70">Timeline</span>12-18 Months</div>
<div><span class="block text-[10px] uppercase opacity-70">Complexity</span>High</div>
</div>
</div>
</div>
</div>
<!-- Committee / Approval -->
<div class="mb-6">
<h4 class="text-xs font-bold text-text-secondary uppercase tracking-wide mb-3">Committee Status</h4>
<div class="bg-panel-dark border border-panel-border rounded-lg p-3">
<div class="flex items-center justify-between mb-3">
<span class="text-sm font-medium text-white">Level 2 Approval Req.</span>
<span class="text-xs text-warning bg-warning/10 px-2 py-0.5 rounded border border-warning/20">Pending</span>
</div>
<div class="flex items-center gap-2 mb-3">
<div class="flex -space-x-2">
<div class="size-6 rounded-full border border-background-dark bg-gray-500" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuBv3O6_6sb4Lt4T2LglVMPNXwK-yariq2vQ8PmZxtTtHxsss8M57hZbeSEajJ7oxE7nNz9fmzjqq7M6UbZTherShJ5uKul5aILEj4L9alpLozO5iyKJaCXGnG5KjyxtKJ7D1UjK2zEiS49rg4eQPdhzacfLZwVg8p42zCyf6LzWLpxGWXc2uHnqT1edPZza6SVjLii158jBkePGisDRD_P5keRFuz4xsV3rvYwzb3VMpexc1MRDbnycQ63w39tKWV9-CDpO66GfRO0'); background-size: cover;"></div>
<div class="size-6 rounded-full border border-background-dark bg-gray-600" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuDMSV4LiuyPEYua3s2qPrR1c9DSzTb9aA3qjGwrLQHd8rl6r8p-fRKNFNZfQXdatQHDnPwePx--Cz3B88bcpfHkk-IENVf33-jgix0oCFRrAHj4dMmL-zH1iM8b4yenFWEUuEo-YD-yD95IhvAHcniqGQmsB9lbAHm37cKSRJDe4FhS_zFun5PlpSSXOeTolqUWgaXhTK5jjLOYRwBPpBaGYzApQY5kZk6cqI6x-SDECG-EaFqysmVn-YVtPakODeMolGY5I_7XEGU'); background-size: cover;"></div>
<div class="size-6 rounded-full border border-background-dark bg-gray-700 flex items-center justify-center text-[10px] text-white font-bold">+1</div>
</div>
<span class="text-xs text-text-secondary">Quorum not met</span>
</div>
<div class="grid grid-cols-2 gap-2">
<button class="flex items-center justify-center gap-1 bg-[#282f39] hover:bg-[#3b4554] text-white text-xs font-medium py-1.5 rounded border border-[#3b4554] transition-colors">
<span class="material-symbols-outlined text-[14px]">edit_note</span> Prepare Waiver
                            </button>
<button class="flex items-center justify-center gap-1 bg-[#282f39] hover:bg-[#3b4554] text-white text-xs font-medium py-1.5 rounded border border-[#3b4554] transition-colors">
<span class="material-symbols-outlined text-[14px]">gavel</span> Escalate
                            </button>
</div>
</div>
</div>
<!-- Borrower Comms -->
<div>
<h4 class="text-xs font-bold text-text-secondary uppercase tracking-wide mb-3">Borrower Comms</h4>
<div class="bg-panel-dark border border-panel-border rounded-lg p-3">
<p class="text-xs text-text-secondary mb-1">Last Message (Yesterday):</p>
<p class="text-sm text-white italic mb-3">"We have sent the updated rent roll as requested..."</p>
<button class="w-full flex items-center justify-center gap-2 bg-[#282f39] hover:bg-[#3b4554] text-white text-xs font-medium py-1.5 rounded border border-[#3b4554] transition-colors">
<span class="material-symbols-outlined text-[14px]">mail</span> Send Secure Message
                        </button>
</div>
</div>
</div>
</aside>
<!-- Bottom Sticky Action Bar (Floating) -->
<div class="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 w-auto">
<div class="glass-panel px-2 py-2 rounded-xl border border-panel-border shadow-2xl flex items-center gap-2">
<button class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white text-sm font-bold rounded-lg shadow-lg shadow-primary/20 transition-all transform hover:scale-105">
<span class="material-symbols-outlined text-[18px]">check_circle</span> Approve Strategy
                </button>
<div class="w-px h-6 bg-panel-border mx-1"></div>
<button class="flex items-center gap-2 px-3 py-2 text-text-secondary hover:text-white hover:bg-[#282f39] rounded-lg text-sm font-medium transition-colors">
<span class="material-symbols-outlined text-[18px]">campaign</span> Generate Notice
                </button>
<button class="flex items-center gap-2 px-3 py-2 text-text-secondary hover:text-white hover:bg-[#282f39] rounded-lg text-sm font-medium transition-colors">
<span class="material-symbols-outlined text-[18px]">edit_document</span> Log Note
                </button>
<button class="flex items-center gap-2 px-3 py-2 text-text-secondary hover:text-white hover:bg-[#282f39] rounded-lg text-sm font-medium transition-colors">
<span class="material-symbols-outlined text-[18px]">more_vert</span>
</button>
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
