import { redirect } from "next/navigation";

const TITLE = "Buddy the Underwriter - OCR Review";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `</script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script>
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "primary": "#136dec",
              "background-light": "#f6f7f8",
              "background-dark": "#111418", // Darker background for the cockpit feel
              "panel-dark": "#1A202C", // Slightly lighter for panels
              "border-dark": "#2D3748",
            },
            fontFamily: {
              "display": ["Inter", "sans-serif"],
              "mono": ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }`;
const STYLES = [
  "/* Custom scrollbar for dense data panels */\n        ::-webkit-scrollbar {\n            width: 6px;\n            height: 6px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #111418; \n        }\n        ::-webkit-scrollbar-thumb {\n            background: #4A5568; \n            border-radius: 3px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #718096; \n        }\n        \n        /* Glassmorphism utility */\n        .glass-panel {\n            background: rgba(26, 32, 44, 0.7);\n            backdrop-filter: blur(10px);\n            border: 1px solid rgba(255, 255, 255, 0.08);\n        }\n        \n        .active-row-indicator {\n            box-shadow: inset 4px 0 0 0 #136dec;\n            background: rgba(19, 109, 236, 0.1);\n        }"
];
const BODY_HTML = `<!-- Top Navigation -->
<header class="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-solid border-b-[#282f39] bg-[#111418] px-6 py-3 z-20">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3 text-white">
<div class="size-6 text-primary">
<span class="material-symbols-outlined text-[28px]">shield_person</span>
</div>
<h2 class="text-white text-lg font-bold leading-tight tracking-tight">Buddy the Underwriter</h2>
</div>
<label class="flex flex-col min-w-40 !h-9 max-w-64 group">
<div class="flex w-full flex-1 items-stretch rounded-lg h-full transition-all group-focus-within:ring-1 group-focus-within:ring-primary/50">
<div class="text-[#9da8b9] flex border-none bg-[#1F2937] items-center justify-center pl-3 rounded-l-lg border-r-0">
<span class="material-symbols-outlined text-[20px]">search</span>
</div>
<input class="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-0 border-none bg-[#1F2937] focus:border-none h-full placeholder:text-[#64748b] px-3 rounded-l-none border-l-0 pl-2 text-sm font-normal leading-normal" placeholder="Search deals, borrowers..." value=""/>
</div>
</label>
</div>
<div class="flex flex-1 justify-end gap-6 items-center">
<nav class="flex items-center gap-6 hidden xl:flex">
<a class="text-white text-sm font-medium hover:text-primary transition-colors" href="#">Deals</a>
<a class="text-primary text-sm font-bold border-b-2 border-primary pb-0.5" href="#">Intake</a>
<a class="text-[#9da8b9] text-sm font-medium hover:text-white transition-colors" href="#">Portfolio</a>
<a class="text-[#9da8b9] text-sm font-medium hover:text-white transition-colors" href="#">Committee</a>
<a class="text-[#9da8b9] text-sm font-medium hover:text-white transition-colors" href="#">Reporting</a>
</nav>
<div class="h-6 w-px bg-[#282f39] mx-2 hidden xl:block"></div>
<div class="flex gap-3">
<button class="flex items-center justify-center rounded-lg size-9 bg-[#1F2937] text-[#9da8b9] hover:text-white hover:bg-[#374151] transition-all relative">
<span class="material-symbols-outlined text-[20px]">notifications</span>
<span class="absolute top-2 right-2 size-1.5 bg-red-500 rounded-full"></span>
</button>
<div class="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-9 border border-[#282f39]" data-alt="User Avatar Profile Picture" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuBImlw7Tmiim0I6MZHMnkD3kmgMjvpKFtC2cb3j4q3Nn_d5UWTqMwipDdnCMcW5ZVXVTzyga6o3m310YlhX_laDS-OJ758sewd5pXWe206ZZfrYcASfYhFs85nzsvUi_JJYVLEPEsCXATkaRMLx6uSbTm6_7EjDODGjmipp2hfDP4ZFaHpBmwjrUE6ZRePLTJQekzirLJmT9npDmGJtL5gjRPav1mb_YlAASUOZ59URKY8F8N6oZSfh84MUBjsHGefCkcGaZM1NONQ");'></div>
</div>
</div>
</header>
<!-- Main Content Area -->
<main class="flex flex-1 overflow-hidden relative">
<!-- Left Panel: Document Set + Evidence Navigator -->
<aside class="w-[320px] flex flex-col border-r border-border-dark bg-[#111418] shrink-0 z-10">
<!-- Breadcrumbs & Title Area -->
<div class="p-5 border-b border-border-dark">
<div class="flex items-center gap-1.5 mb-3 text-xs">
<a class="text-[#64748b] hover:text-[#9da8b9]" href="#">Intake</a>
<span class="text-[#475569]">/</span>
<a class="text-[#64748b] hover:text-[#9da8b9]" href="#">OCR Review</a>
<span class="text-[#475569]">/</span>
<span class="text-white font-medium">Create Snapshot</span>
</div>
<h1 class="text-white text-xl font-bold leading-tight">Evidence Navigator</h1>
<p class="text-[#64748b] text-xs mt-1">4 Documents Processed • 2 Pending</p>
</div>
<!-- Filter Chips -->
<div class="px-4 py-3 border-b border-border-dark flex gap-2 overflow-x-auto no-scrollbar">
<button class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1F2937] border border-[#374151] text-xs font-medium text-white hover:bg-[#374151] whitespace-nowrap">
                    All
                </button>
<button class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1F2937] border border-red-500/30 text-xs font-medium text-red-400 hover:bg-red-900/20 whitespace-nowrap">
                    Conflicts (5)
                </button>
<button class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1F2937] border border-[#374151] text-xs font-medium text-[#9da8b9] hover:bg-[#374151] whitespace-nowrap">
                    Unreadable
                </button>
</div>
<!-- Document List -->
<div class="flex-1 overflow-y-auto p-2 space-y-1">
<!-- Doc Item 1: Active -->
<div class="p-3 rounded-lg bg-[#1F2937] border border-primary/40 cursor-pointer relative group">
<div class="flex justify-between items-start mb-1">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-900/50 text-blue-300 border border-blue-800">OM</span>
<span class="text-[#64748b] text-[10px]">Just now</span>
</div>
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-green-500 text-[18px]">verified</span>
<p class="text-white text-sm font-medium truncate" title="Offering_Memorandum_ProjectAtlas_vFinal.pdf">Offering_Memo_Atlas...</p>
</div>
<div class="mt-2 flex items-center justify-between">
<div class="h-1 w-16 bg-[#374151] rounded-full overflow-hidden">
<div class="h-full bg-green-500 w-[92%]"></div>
</div>
<span class="text-[10px] text-[#9da8b9]">92% Match</span>
</div>
</div>
<!-- Doc Item 2 -->
<div class="p-3 rounded-lg hover:bg-[#1A202C] border border-transparent hover:border-[#374151] cursor-pointer transition-colors group">
<div class="flex justify-between items-start mb-1">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-900/50 text-purple-300 border border-purple-800">RENT ROLL</span>
<span class="text-[#64748b] text-[10px]">2m ago</span>
</div>
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-amber-500 text-[18px]">warning</span>
<p class="text-[#cbd5e1] text-sm font-medium truncate">Rent_Roll_Q3_2023.xlsx</p>
</div>
<div class="mt-2 flex items-center justify-between">
<div class="h-1 w-16 bg-[#374151] rounded-full overflow-hidden">
<div class="h-full bg-amber-500 w-[65%]"></div>
</div>
<span class="text-[10px] text-[#9da8b9]">Review Needed</span>
</div>
</div>
<!-- Doc Item 3 -->
<div class="p-3 rounded-lg hover:bg-[#1A202C] border border-transparent hover:border-[#374151] cursor-pointer transition-colors group">
<div class="flex justify-between items-start mb-1">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-700/50 text-gray-300 border border-gray-600">FINANCIALS</span>
<span class="text-[#64748b] text-[10px]">4m ago</span>
</div>
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-green-500 text-[18px]">verified</span>
<p class="text-[#cbd5e1] text-sm font-medium truncate">T12_Statement_Final.pdf</p>
</div>
</div>
<!-- Doc Item 4: Error -->
<div class="p-3 rounded-lg hover:bg-[#1A202C] border border-transparent hover:border-[#374151] cursor-pointer transition-colors group opacity-75">
<div class="flex justify-between items-start mb-1">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-500 border border-gray-700">ENV</span>
<span class="text-[#64748b] text-[10px]">10m ago</span>
</div>
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-red-500 text-[18px]">error</span>
<p class="text-[#9da8b9] text-sm font-medium truncate">Environmental_PhaseI.pdf</p>
</div>
<div class="mt-2 text-[10px] text-red-400">Unreadable / Corrupt</div>
</div>
</div>
</aside>
<!-- Center Panel: Field Validation Table (The Cockpit) -->
<section class="flex-1 flex flex-col bg-[#0F1216] relative overflow-hidden">
<!-- Page Heading within Center Panel -->
<div class="p-6 pb-2 border-b border-border-dark flex justify-between items-end bg-[#111418]">
<div>
<h2 class="text-2xl font-bold text-white tracking-tight">Data Validation Console</h2>
<p class="text-[#9da8b9] text-sm mt-1">Review extraction results and resolve conflicts before approval.</p>
</div>
<div class="flex gap-2">
<button class="flex items-center gap-2 px-3 py-1.5 bg-[#1F2937] hover:bg-[#374151] rounded text-xs font-bold text-white border border-[#374151] transition-colors">
<span class="material-symbols-outlined text-[16px]">tune</span>
                        Configure Columns
                    </button>
<button class="flex items-center gap-2 px-3 py-1.5 bg-[#1F2937] hover:bg-[#374151] rounded text-xs font-bold text-white border border-[#374151] transition-colors">
<span class="material-symbols-outlined text-[16px]">filter_list</span>
                        Filters
                    </button>
</div>
</div>
<!-- Sticky Header for Grid -->
<div class="grid grid-cols-12 gap-4 px-6 py-3 bg-[#111418] border-b border-border-dark text-xs font-bold text-[#64748b] uppercase tracking-wider sticky top-0 z-10">
<div class="col-span-3">Field Name</div>
<div class="col-span-3">Golden Value <span class="text-primary normal-case ml-1">(Selected)</span></div>
<div class="col-span-3">Source Candidates</div>
<div class="col-span-2">Status</div>
<div class="col-span-1 text-right">Action</div>
</div>
<!-- Scrollable Grid Content -->
<div class="flex-1 overflow-y-auto pb-20"> <!-- pb-20 for sticky footer space -->
<!-- Section Header -->
<div class="px-6 py-2 bg-[#1A202C]/50 text-xs font-bold text-[#9da8b9] uppercase border-b border-border-dark flex items-center gap-2">
<span class="material-symbols-outlined text-[14px]">apartment</span> Property Economics
                </div>
<!-- Row 1: Conflict (Active Selection) -->
<div class="grid grid-cols-12 gap-4 px-6 py-4 border-b border-border-dark items-center active-row-indicator bg-[#1F2937]/30 cursor-pointer hover:bg-[#1F2937]/50 transition-colors">
<div class="col-span-3">
<p class="text-white text-sm font-semibold">Net Operating Income (NOI)</p>
<p class="text-[#64748b] text-xs">T-12 Trailing</p>
</div>
<div class="col-span-3">
<div class="flex items-center gap-2">
<span class="text-primary font-mono font-bold text-sm bg-blue-900/20 px-2 py-1 rounded border border-blue-900/50">$4,250,000</span>
</div>
</div>
<div class="col-span-3 flex flex-wrap gap-2">
<span class="px-2 py-1 rounded bg-[#1F2937] border border-blue-500/50 text-xs text-white cursor-pointer hover:bg-[#374151] line-through decoration-red-500/50 decoration-2 opacity-60" title="T-12 Statement">$4,100,000</span>
<span class="px-2 py-1 rounded bg-primary/20 border border-primary text-xs text-white cursor-pointer shadow-[0_0_10px_rgba(19,109,236,0.3)]" title="Offering Memo">$4,250,000</span>
</div>
<div class="col-span-2">
<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-900/20 text-amber-500 border border-amber-900/50 text-xs font-bold">
<span class="size-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                            Conflict
                        </span>
</div>
<div class="col-span-1 text-right">
<button class="text-primary hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">arrow_forward_ios</span>
</button>
</div>
</div>
<!-- Row 2: Conflict -->
<div class="grid grid-cols-12 gap-4 px-6 py-4 border-b border-border-dark items-center hover:bg-[#1F2937]/30 cursor-pointer transition-colors">
<div class="col-span-3">
<p class="text-slate-300 text-sm font-medium">Occupancy Rate</p>
<p class="text-[#64748b] text-xs">Physical</p>
</div>
<div class="col-span-3">
<div class="flex items-center gap-2">
<span class="text-slate-400 font-mono font-medium text-sm border border-transparent px-2 py-1">--</span>
</div>
</div>
<div class="col-span-3 flex flex-wrap gap-2">
<span class="px-2 py-1 rounded bg-[#1F2937] border border-[#374151] text-xs text-slate-300 hover:bg-[#374151]">94.2%</span>
<span class="px-2 py-1 rounded bg-[#1F2937] border border-[#374151] text-xs text-slate-300 hover:bg-[#374151]">90.4%</span>
</div>
<div class="col-span-2">
<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-900/20 text-amber-500 border border-amber-900/50 text-xs font-bold">
                            Conflict
                        </span>
</div>
<div class="col-span-1 text-right">
<button class="text-[#64748b] hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">arrow_forward_ios</span>
</button>
</div>
</div>
<!-- Row 3: OK -->
<div class="grid grid-cols-12 gap-4 px-6 py-4 border-b border-border-dark items-center hover:bg-[#1F2937]/30 cursor-pointer transition-colors">
<div class="col-span-3">
<p class="text-slate-300 text-sm font-medium">Address</p>
</div>
<div class="col-span-3">
<span class="text-white font-medium text-sm">1200 Atlas Blvd, Austin TX</span>
</div>
<div class="col-span-3 flex flex-wrap gap-2">
<span class="px-2 py-1 rounded bg-green-900/20 border border-green-800 text-xs text-green-400">Consistent (3 sources)</span>
</div>
<div class="col-span-2">
<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-900/10 text-green-500 border border-transparent text-xs font-bold">
<span class="material-symbols-outlined text-[14px]">check_circle</span>
                            OK
                        </span>
</div>
<div class="col-span-1 text-right">
<button class="text-[#64748b] hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">arrow_forward_ios</span>
</button>
</div>
</div>
<!-- Section Header -->
<div class="px-6 py-2 bg-[#1A202C]/50 text-xs font-bold text-[#9da8b9] uppercase border-b border-border-dark flex items-center gap-2 mt-4">
<span class="material-symbols-outlined text-[14px]">gavel</span> Loan Terms
                </div>
<!-- Row 4: Low Confidence -->
<div class="grid grid-cols-12 gap-4 px-6 py-4 border-b border-border-dark items-center hover:bg-[#1F2937]/30 cursor-pointer transition-colors">
<div class="col-span-3">
<p class="text-slate-300 text-sm font-medium">Interest Rate Type</p>
</div>
<div class="col-span-3">
<span class="text-slate-400 font-medium text-sm italic">Floating?</span>
</div>
<div class="col-span-3 flex flex-wrap gap-2">
<span class="px-2 py-1 rounded bg-[#1F2937] border border-[#374151] text-xs text-slate-300">Floating</span>
</div>
<div class="col-span-2">
<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-700/30 text-gray-400 border border-gray-600 text-xs font-bold">
                            Low Confidence (42%)
                        </span>
</div>
<div class="col-span-1 text-right">
<button class="text-[#64748b] hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">arrow_forward_ios</span>
</button>
</div>
</div>
<!-- Row 5: Missing -->
<div class="grid grid-cols-12 gap-4 px-6 py-4 border-b border-border-dark items-center hover:bg-[#1F2937]/30 cursor-pointer transition-colors">
<div class="col-span-3">
<p class="text-slate-300 text-sm font-medium">Guarantor Name</p>
<p class="text-red-400 text-xs">* Required</p>
</div>
<div class="col-span-3">
<span class="text-slate-600 font-mono text-sm">--</span>
</div>
<div class="col-span-3 flex flex-wrap gap-2">
<span class="text-xs text-[#64748b] italic">No values found</span>
</div>
<div class="col-span-2">
<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-900/10 text-red-500 border border-red-900/50 text-xs font-bold">
                            Missing
                        </span>
</div>
<div class="col-span-1 text-right">
<button class="text-[#64748b] hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">add_circle</span>
</button>
</div>
</div>
</div>
<!-- Floating Action Bar (Sticky Footer) -->
<div class="absolute bottom-0 left-0 right-0 bg-[#111418] border-t border-border-dark p-4 flex items-center justify-between z-20">
<div class="flex items-center gap-6">
<div class="flex items-center gap-2">
<div class="size-2 rounded-full bg-amber-500 animate-pulse"></div>
<span class="text-sm text-[#9da8b9]">5 Conflicts Remaining</span>
</div>
<div class="h-4 w-px bg-[#282f39]"></div>
<div class="flex items-center gap-2">
<div class="size-2 rounded-full bg-red-500"></div>
<span class="text-sm text-[#9da8b9]">1 Missing Required</span>
</div>
<div class="h-4 w-px bg-[#282f39]"></div>
<p class="text-xs text-[#64748b] font-mono">Audit ID: #BD-2024-X99</p>
</div>
<div class="flex gap-3">
<button class="px-4 py-2 rounded-lg border border-[#374151] text-sm font-bold text-[#9da8b9] hover:bg-[#1F2937] hover:text-white transition-colors">
                        Save Draft
                    </button>
<button class="px-4 py-2 rounded-lg border border-[#374151] text-sm font-bold text-[#9da8b9] hover:bg-[#1F2937] hover:text-white transition-colors flex items-center gap-2">
<span class="material-symbols-outlined text-[18px]">download</span>
                        Log
                    </button>
<button class="px-6 py-2 rounded-lg bg-primary text-white text-sm font-bold shadow-[0_0_15px_rgba(19,109,236,0.4)] hover:shadow-[0_0_20px_rgba(19,109,236,0.6)] hover:bg-blue-600 transition-all flex items-center gap-2">
<span class="material-symbols-outlined text-[20px]">check_circle</span>
                        Approve Validated Snapshot
                    </button>
</div>
</div>
</section>
<!-- Right Panel: Side-by-Side Compare & Audit -->
<aside class="w-[400px] flex flex-col bg-[#111418] border-l border-border-dark shrink-0 z-10 overflow-hidden">
<!-- Context Header -->
<div class="p-5 border-b border-border-dark bg-[#1A202C]">
<div class="flex justify-between items-start mb-2">
<h3 class="text-white text-lg font-bold">Deep Compare</h3>
<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-900/30 text-amber-500 border border-amber-800">CONFLICT DETECTED</span>
</div>
<p class="text-[#9da8b9] text-sm">Target Field: <span class="text-white font-medium">Net Operating Income</span></p>
</div>
<div class="flex-1 overflow-y-auto p-5 space-y-6">
<!-- Section A: Golden Value Selection -->
<div class="space-y-3">
<div class="flex items-center justify-between">
<label class="text-xs font-bold text-[#64748b] uppercase tracking-wide">Candidate Values</label>
<span class="text-xs text-primary cursor-pointer hover:underline">Why Buddy thinks this?</span>
</div>
<!-- Card 1: Selected -->
<div class="relative rounded-xl border border-primary bg-[#1F2937] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.3)] group cursor-pointer">
<div class="absolute -right-1 -top-1 bg-primary text-white rounded-full p-0.5 border-4 border-[#1F2937]">
<span class="material-symbols-outlined text-[16px] block">check</span>
</div>
<div class="flex justify-between items-start mb-3">
<div class="flex flex-col">
<span class="text-2xl font-mono font-bold text-white">$4,250,000</span>
<span class="text-xs text-green-400 flex items-center gap-1 mt-1">
<span class="material-symbols-outlined text-[14px]">psychology</span>
                                    High Confidence (94%)
                                </span>
</div>
</div>
<div class="flex items-center gap-2 mt-2">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-900/30 text-blue-300 border border-blue-800">OM</span>
<span class="text-xs text-[#9da8b9]">Page 4 • Table 2</span>
</div>
</div>
<!-- Card 2: Conflict -->
<div class="relative rounded-xl border border-[#374151] hover:border-[#64748b] bg-[#111418] p-4 opacity-80 hover:opacity-100 transition-all cursor-pointer group">
<div class="flex justify-between items-start mb-3">
<div class="flex flex-col">
<span class="text-xl font-mono font-bold text-[#9da8b9] group-hover:text-white">$4,100,000</span>
<span class="text-xs text-amber-500 flex items-center gap-1 mt-1">
                                    Older Document
                                </span>
</div>
<button class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs bg-[#374151] rounded text-white hover:bg-primary transition-all">Select</button>
</div>
<div class="flex items-center gap-2 mt-2">
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-900/30 text-purple-300 border border-purple-800">RENT ROLL</span>
<span class="text-xs text-[#9da8b9]">Page 12 • Row 44</span>
</div>
</div>
</div>
<!-- Section B: Evidence Preview -->
<div class="space-y-3 pt-2">
<div class="flex items-center justify-between">
<label class="text-xs font-bold text-[#64748b] uppercase tracking-wide">Evidence Preview</label>
<button class="text-xs text-primary flex items-center gap-1 hover:text-white transition-colors">
<span class="material-symbols-outlined text-[14px]">open_in_new</span>
                            Open Viewer
                         </button>
</div>
<div class="rounded-lg border border-[#374151] bg-[#000] overflow-hidden relative group">
<!-- Abstract representation of a document preview -->
<div class="w-full h-48 bg-[#1F2937] relative opacity-90" data-alt="PDF Document Preview with Highlight">
<div class="absolute inset-0 p-4 space-y-2 opacity-50">
<div class="h-2 w-3/4 bg-[#4A5568] rounded"></div>
<div class="h-2 w-full bg-[#4A5568] rounded"></div>
<div class="h-2 w-5/6 bg-[#4A5568] rounded"></div>
<div class="h-2 w-full bg-[#4A5568] rounded"></div>
<div class="h-32 w-full border border-[#4A5568] mt-4 rounded p-2 grid grid-cols-3 gap-2">
<div class="h-2 bg-[#4A5568] col-span-1"></div><div class="h-2 bg-[#4A5568] col-span-1"></div><div class="h-2 bg-[#4A5568] col-span-1"></div>
<div class="h-2 bg-[#4A5568] col-span-1"></div><div class="h-2 bg-[#4A5568] col-span-1"></div><div class="h-2 bg-[#4A5568] col-span-1"></div>
</div>
</div>
<!-- Highlight Box -->
<div class="absolute top-[55%] left-[60%] w-[30%] h-[12%] bg-primary/30 border-2 border-primary rounded shadow-[0_0_15px_rgba(19,109,236,0.4)] animate-pulse"></div>
</div>
</div>
<p class="text-xs text-[#64748b] leading-relaxed italic">
                        "The Net Operating Income for the trailing 12-month period is calculated at <span class="text-white font-mono">$4,250,000</span> based on..."
                    </p>
</div>
<!-- Section C: Validation Actions -->
<div class="pt-4 border-t border-border-dark space-y-3">
<label class="text-xs font-bold text-[#64748b] uppercase tracking-wide">Actions</label>
<div class="grid grid-cols-2 gap-3">
<button class="col-span-2 flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg font-bold text-sm transition-colors shadow-lg shadow-blue-900/20">
<span class="material-symbols-outlined text-[18px]">check</span>
                            Confirm Golden Value
                        </button>
<button class="flex items-center justify-center gap-2 px-3 py-2 bg-[#1F2937] hover:bg-[#374151] text-[#9da8b9] hover:text-white rounded-lg font-medium text-xs border border-[#374151] transition-colors">
<span class="material-symbols-outlined text-[16px]">flag</span>
                            Flag Issue
                        </button>
<button class="flex items-center justify-center gap-2 px-3 py-2 bg-[#1F2937] hover:bg-[#374151] text-[#9da8b9] hover:text-white rounded-lg font-medium text-xs border border-[#374151] transition-colors">
<span class="material-symbols-outlined text-[16px]">comment</span>
                            Add Note
                        </button>
</div>
</div>
</div>
<!-- Section D: Snapshot Readiness (Bottom of Right Panel) -->
<div class="p-5 bg-[#0F1216] border-t border-border-dark">
<div class="flex justify-between items-center mb-2">
<h4 class="text-white text-sm font-bold">Snapshot Readiness</h4>
<span class="text-amber-500 text-xs font-bold">Incomplete</span>
</div>
<!-- Progress Bar -->
<div class="h-2 w-full bg-[#1F2937] rounded-full overflow-hidden mb-3">
<div class="h-full bg-gradient-to-r from-green-500 to-green-400 w-[65%] rounded-full relative">
<div class="absolute right-0 top-0 bottom-0 w-1 bg-white/50"></div>
</div>
</div>
<div class="flex justify-between text-xs text-[#64748b]">
<span>65% Validated</span>
<span>12 Fields Pending</span>
</div>
</div>
</aside>
</main>`;

export default function Page() {
  redirect("/deals");
  return null;
}
