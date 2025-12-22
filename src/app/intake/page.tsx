import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Buddy the Underwriter - Deal Intake Console";
const FONT_LINKS = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `</script>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "primary-dark": "#0f5bb8",
                        "background-light": "#f6f7f8",
                        "background-dark": "#101822",
                        "surface-dark": "#1a222d",
                        "surface-darker": "#151b24",
                        "border-dark": "#2d3642",
                        "success": "#10b981",
                        "warning": "#f59e0b",
                        "danger": "#ef4444",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "mono": ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"]
                    },
                },
            },
        }`;
const STYLES = [
  "body { font-family: 'Inter', sans-serif; }\n        /* Custom scrollbar for dense data panels */\n        ::-webkit-scrollbar {\n            width: 6px;\n            height: 6px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #1a222d;\n        }\n        ::-webkit-scrollbar-thumb {\n            background: #2d3642;\n            border-radius: 3px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #4b5563;\n        }\n        .glass-panel {\n            background: rgba(26, 34, 45, 0.6);\n            backdrop-filter: blur(12px);\n            border: 1px solid rgba(255, 255, 255, 0.05);\n        }"
];
const BODY_HTML = `<!-- Top Navigation -->
<header class="flex-none h-16 border-b border-border-dark bg-[#111418] px-6 flex items-center justify-between z-50">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3">
<div class="size-8 text-primary">
<svg fill="currentColor" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<path d="M24 45.8096C19.6865 45.8096 15.4698 44.5305 11.8832 42.134C8.29667 39.7376 5.50128 36.3314 3.85056 32.3462C2.19985 28.361 1.76794 23.9758 2.60947 19.7452C3.451 15.5145 5.52816 11.6284 8.57829 8.5783C11.6284 5.52817 15.5145 3.45101 19.7452 2.60948C23.9758 1.76795 28.361 2.19986 32.3462 3.85057C36.3314 5.50129 39.7376 8.29668 42.134 11.8833C44.5305 15.4698 45.8096 19.6865 45.8096 24L24 24L24 45.8096Z"></path>
</svg>
</div>
<h1 class="text-white text-lg font-bold tracking-tight">Buddy the Underwriter</h1>
</div>
<nav class="hidden md:flex items-center gap-1">
<a class="px-4 py-2 text-sm font-medium text-white border-b-2 border-primary bg-primary/10 rounded-t" href="#">Deals</a>
<a class="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-surface-dark rounded-t transition-colors" href="#">Portfolio</a>
<a class="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-surface-dark rounded-t transition-colors" href="#">Committee</a>
<a class="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-surface-dark rounded-t transition-colors" href="#">Reporting</a>
</nav>
</div>
<div class="flex items-center gap-6">
<div class="relative w-96 hidden lg:block">
<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
<span class="material-symbols-outlined text-gray-500 text-[20px]">search</span>
</div>
<input class="block w-full pl-10 pr-3 py-2 border border-border-dark rounded-lg leading-5 bg-surface-darker text-gray-300 placeholder-gray-500 focus:outline-none focus:bg-surface-dark focus:border-primary sm:text-sm" placeholder="Search deals, borrowers, documents..." type="text"/>
</div>
<div class="flex items-center gap-4">
<button class="text-gray-400 hover:text-white relative">
<span class="material-symbols-outlined">notifications</span>
<span class="absolute top-0 right-0 block h-2 w-2 rounded-full bg-danger ring-2 ring-background-dark"></span>
</button>
<div class="size-9 rounded-full bg-gradient-to-tr from-primary to-blue-400 p-[2px]">
<img alt="User Avatar" class="rounded-full h-full w-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDSnswgy_qet5rR8I1K0x9zbqtEx_VVU8ZRXUkVDpmHQ5Mz4KCvqaNNnvygVEoDrIj869uhW1YSvjDYJjbYK2PRMGXLjlSudPU1laN4_8It5oK1Dv2ki9kTay1H5OhxP9MS9Agjla_x_VXqxlPkPT1MxwP_VPeogYf3yvIDd1SDVOGWyRtOYIa0IlUe44pxYlP31KXhARgSDf6fWS2YTCSuBC_6v70zsbenkdc1qr9LYek3Ykpq_XFNOIfXkQZLrD0iR5O_dbbBwV0"/>
</div>
</div>
</div>
</header>
<!-- Main Content Grid -->
<main class="flex-1 overflow-hidden flex flex-col lg:flex-row bg-[#0b0e14]">
<!-- Left Panel: Package Checklist -->
<aside class="w-full lg:w-[280px] xl:w-[320px] flex-none border-r border-border-dark bg-surface-darker flex flex-col overflow-hidden">
<div class="p-5 border-b border-border-dark">
<h2 class="text-xl font-bold text-white mb-1">Deal Intake</h2>
<p class="text-xs text-gray-400">ID: #DL-2023-8921 • Office/MF</p>
</div>
<div class="flex-1 overflow-y-auto p-4 space-y-6">
<!-- Progress Section -->
<div class="bg-surface-dark rounded-xl p-4 border border-border-dark">
<div class="flex justify-between items-end mb-2">
<div>
<p class="text-xs font-medium text-gray-400 uppercase tracking-wider">Package Health</p>
<p class="text-2xl font-bold text-white">85%</p>
</div>
<span class="bg-danger/20 text-danger text-xs px-2 py-1 rounded font-medium border border-danger/20">1 Critical Missing</span>
</div>
<div class="w-full bg-gray-700 rounded-full h-2 mb-3">
<div class="bg-primary h-2 rounded-full" style="width: 85%"></div>
</div>
<button class="w-full py-2 px-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-primary font-medium flex items-center justify-center gap-2 transition-colors">
<span class="material-symbols-outlined text-[18px]">mail</span>
                        Request Missing Docs
                    </button>
</div>
<!-- Checklists -->
<div class="space-y-4">
<!-- Core Docs -->
<div>
<div class="flex items-center justify-between mb-2">
<h3 class="text-sm font-semibold text-gray-300">Core Deal Docs (4/5)</h3>
<span class="text-xs text-gray-500">Incomplete</span>
</div>
<div class="space-y-2">
<div class="flex items-center gap-3 p-2 rounded bg-surface-dark border border-border-dark/50">
<span class="material-symbols-outlined text-success text-[18px]">check_circle</span>
<div class="flex-1 min-w-0">
<p class="text-xs font-medium text-gray-200 truncate">Offering Memorandum</p>
<p class="text-[10px] text-gray-500">Verified • 2h ago</p>
</div>
</div>
<div class="flex items-center gap-3 p-2 rounded bg-surface-dark border border-border-dark/50">
<span class="material-symbols-outlined text-success text-[18px]">check_circle</span>
<div class="flex-1 min-w-0">
<p class="text-xs font-medium text-gray-200 truncate">Rent Roll - Current</p>
<p class="text-[10px] text-gray-500">Processing Complete</p>
</div>
</div>
<div class="flex items-center gap-3 p-2 rounded bg-surface-dark border border-border-dark/50">
<span class="material-symbols-outlined text-success text-[18px]">check_circle</span>
<div class="flex-1 min-w-0">
<p class="text-xs font-medium text-gray-200 truncate">T-12 Operating Stmt</p>
<p class="text-[10px] text-gray-500">Excel format</p>
</div>
</div>
<div class="flex items-center gap-3 p-2 rounded bg-surface-dark border border-danger/30">
<span class="material-symbols-outlined text-danger text-[18px]">cancel</span>
<div class="flex-1 min-w-0">
<p class="text-xs font-medium text-gray-200 truncate">Tax Bills (Current)</p>
<p class="text-[10px] text-danger">Missing - Critical</p>
</div>
</div>
</div>
</div>
<!-- Credit & Sponsor -->
<div>
<div class="flex items-center justify-between mb-2">
<h3 class="text-sm font-semibold text-gray-300">Credit &amp; Sponsor (2/3)</h3>
</div>
<div class="space-y-2">
<div class="flex items-center gap-3 p-2 rounded bg-surface-dark border border-border-dark/50">
<span class="material-symbols-outlined text-success text-[18px]">check_circle</span>
<div class="flex-1 min-w-0">
<p class="text-xs font-medium text-gray-200 truncate">Sponsor Org Chart</p>
<p class="text-[10px] text-gray-500">Verified</p>
</div>
</div>
<div class="flex items-center gap-3 p-2 rounded bg-surface-dark border border-warning/30">
<span class="material-symbols-outlined text-warning text-[18px]">error</span>
<div class="flex-1 min-w-0">
<p class="text-xs font-medium text-gray-200 truncate">Sponsor PFS</p>
<p class="text-[10px] text-warning">Outdated (2022)</p>
</div>
</div>
</div>
</div>
</div>
</div>
</aside>
<!-- Center Panel: The Engine -->
<section class="flex-1 flex flex-col min-w-0 bg-[#111418] relative">
<!-- Upload Zone Header -->
<div class="p-6 border-b border-border-dark">
<div class="bg-surface-darker border-2 border-dashed border-primary/40 hover:border-primary rounded-xl p-8 transition-colors group cursor-pointer relative overflow-hidden">
<div class="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
<div class="flex flex-col items-center justify-center text-center relative z-10">
<div class="bg-primary/20 p-3 rounded-full mb-3 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
<span class="material-symbols-outlined text-[32px]">cloud_upload</span>
</div>
<h3 class="text-lg font-semibold text-white mb-1">Drag &amp; Drop Deal Package</h3>
<p class="text-sm text-gray-400 mb-4">Support for PDF, Excel, Word. Max 500MB.</p>
<div class="flex gap-3">
<button class="px-4 py-2 bg-primary hover:bg-primary-dark text-white text-sm font-medium rounded-lg transition-colors">Browse Files</button>
<button class="px-4 py-2 bg-surface-dark hover:bg-border-dark border border-border-dark text-gray-300 text-sm font-medium rounded-lg transition-colors">Import from Deal Room</button>
</div>
</div>
</div>
</div>
<!-- Content Area: Split View (Queue + Extraction) -->
<div class="flex-1 flex flex-col min-h-0">
<!-- Live Queue List -->
<div class="flex-none p-6 pb-2">
<div class="flex items-center justify-between mb-4">
<h3 class="text-sm font-semibold text-white uppercase tracking-wider">Live OCR Queue</h3>
<div class="flex gap-2">
<span class="text-xs text-gray-500">Processing: 1</span>
<span class="text-xs text-gray-500">•</span>
<span class="text-xs text-success">Completed: 5</span>
</div>
</div>
<div class="bg-surface-darker rounded-lg border border-border-dark overflow-hidden">
<table class="w-full text-left text-sm">
<thead class="bg-surface-dark text-xs text-gray-400 uppercase font-medium">
<tr>
<th class="px-4 py-3 font-medium">File Name</th>
<th class="px-4 py-3 font-medium">Detected Type</th>
<th class="px-4 py-3 font-medium">Status</th>
<th class="px-4 py-3 font-medium text-right">Confidence</th>
</tr>
</thead>
<tbody class="divide-y divide-border-dark/50">
<tr class="hover:bg-surface-dark/50 group cursor-pointer transition-colors bg-surface-dark/30 border-l-2 border-primary">
<td class="px-4 py-3">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-red-400">picture_as_pdf</span>
<span class="font-medium text-white">Highland_OM_Final.pdf</span>
</div>
</td>
<td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/20 font-medium">Offering Memo</span></td>
<td class="px-4 py-3">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-success text-[16px]">check_circle</span>
<span class="text-gray-300 text-xs">Extracted</span>
</div>
</td>
<td class="px-4 py-3 text-right"><span class="text-success font-medium">98%</span></td>
</tr>
<tr class="hover:bg-surface-dark/50 group cursor-pointer transition-colors">
<td class="px-4 py-3">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-green-400">table_view</span>
<span class="font-medium text-gray-300">T12_Statement_2023.xlsx</span>
</div>
</td>
<td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/20 font-medium">Financials</span></td>
<td class="px-4 py-3">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-success text-[16px]">check_circle</span>
<span class="text-gray-300 text-xs">Extracted</span>
</div>
</td>
<td class="px-4 py-3 text-right"><span class="text-success font-medium">100%</span></td>
</tr>
<tr class="hover:bg-surface-dark/50 group cursor-pointer transition-colors">
<td class="px-4 py-3">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-red-400">picture_as_pdf</span>
<span class="font-medium text-gray-300">Appraisal_Draft_v2.pdf</span>
</div>
</td>
<td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/20 font-medium">Appraisal</span></td>
<td class="px-4 py-3">
<div class="flex items-center gap-2">
<span class="animate-spin material-symbols-outlined text-primary text-[16px]">progress_activity</span>
<span class="text-primary text-xs">Analyzing...</span>
</div>
</td>
<td class="px-4 py-3 text-right"><span class="text-gray-500 font-medium">-</span></td>
</tr>
</tbody>
</table>
</div>
</div>
<!-- Active Extraction View -->
<div class="flex-1 flex overflow-hidden border-t border-border-dark mt-4">
<!-- Doc Preview (Mock) -->
<div class="w-1/2 bg-[#252b36] relative flex flex-col items-center justify-start pt-8 overflow-hidden border-r border-border-dark">
<div class="absolute top-4 left-4 z-10 bg-black/50 px-3 py-1 rounded text-xs text-white backdrop-blur-sm">Page 4 of 42</div>
<div class="w-[80%] h-[120%] bg-white shadow-2xl rounded-t-lg relative overflow-hidden opacity-90">
<!-- Simulated Document Content -->
<div class="p-8 space-y-4">
<div class="h-6 bg-gray-200 w-3/4 mb-8"></div>
<div class="flex justify-between">
<div class="h-4 bg-gray-200 w-1/4"></div>
<div class="h-4 bg-yellow-200/50 border border-yellow-400 w-1/4 relative group cursor-pointer">
<div class="absolute -top-6 left-1/2 -translate-x-1/2 bg-surface-darker text-white text-[10px] px-2 py-1 rounded hidden group-hover:block whitespace-nowrap z-20 shadow-lg">Mapped to: Purchase Price</div>
</div>
</div>
<div class="space-y-2 mt-4">
<div class="h-2 bg-gray-100 w-full"></div>
<div class="h-2 bg-gray-100 w-full"></div>
<div class="h-2 bg-gray-100 w-5/6"></div>
</div>
<div class="grid grid-cols-2 gap-4 mt-8">
<div class="h-24 bg-blue-50 rounded border border-blue-100"></div>
<div class="h-24 bg-blue-50 rounded border border-blue-100"></div>
</div>
</div>
</div>
</div>
<!-- Extraction Fields -->
<div class="w-1/2 bg-surface-darker overflow-y-auto p-6">
<div class="flex justify-between items-center mb-6">
<h4 class="text-sm font-semibold text-white">Extracted Data</h4>
<button class="text-xs text-primary hover:text-white transition-colors">Edit All</button>
</div>
<div class="space-y-4">
<!-- Field Item -->
<div class="group">
<label class="text-[11px] text-gray-500 uppercase font-medium tracking-wide block mb-1">Property Name</label>
<div class="flex items-center gap-2">
<input class="flex-1 bg-surface-dark border border-border-dark rounded px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary focus:border-primary outline-none" type="text" value="The Highland Apartments"/>
<span class="material-symbols-outlined text-success text-[16px]" title="High Confidence">verified</span>
</div>
</div>
<div class="grid grid-cols-2 gap-4">
<div class="group">
<label class="text-[11px] text-gray-500 uppercase font-medium tracking-wide block mb-1">Purchase Price</label>
<div class="flex items-center gap-2">
<input class="flex-1 bg-surface-dark border border-border-dark rounded px-3 py-2 text-sm text-white font-mono focus:ring-1 focus:ring-primary focus:border-primary outline-none" type="text" value="$24,500,000"/>
<span class="material-symbols-outlined text-success text-[16px]" title="High Confidence">verified</span>
</div>
</div>
<div class="group">
<label class="text-[11px] text-gray-500 uppercase font-medium tracking-wide block mb-1">NOI (In-Place)</label>
<div class="flex items-center gap-2">
<input class="flex-1 bg-surface-dark border border-border-dark rounded px-3 py-2 text-sm text-white font-mono focus:ring-1 focus:ring-primary focus:border-primary outline-none" type="text" value="$1,240,000"/>
<span class="material-symbols-outlined text-warning text-[16px]" title="Medium Confidence - Verify">warning</span>
</div>
</div>
</div>
<div class="grid grid-cols-2 gap-4">
<div class="group">
<label class="text-[11px] text-gray-500 uppercase font-medium tracking-wide block mb-1">Units</label>
<div class="flex items-center gap-2">
<input class="flex-1 bg-surface-dark border border-border-dark rounded px-3 py-2 text-sm text-white font-mono focus:ring-1 focus:ring-primary focus:border-primary outline-none" type="text" value="124"/>
<span class="material-symbols-outlined text-success text-[16px]">verified</span>
</div>
</div>
<div class="group">
<label class="text-[11px] text-gray-500 uppercase font-medium tracking-wide block mb-1">Occupancy</label>
<div class="flex items-center gap-2">
<input class="flex-1 bg-surface-dark border border-border-dark rounded px-3 py-2 text-sm text-white font-mono focus:ring-1 focus:ring-primary focus:border-primary outline-none" type="text" value="94.5%"/>
<span class="material-symbols-outlined text-success text-[16px]">verified</span>
</div>
</div>
</div>
<div class="group">
<label class="text-[11px] text-gray-500 uppercase font-medium tracking-wide block mb-1">Address</label>
<div class="flex items-center gap-2">
<input class="flex-1 bg-surface-dark border border-border-dark rounded px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary focus:border-primary outline-none" type="text" value="1200 N Highland Ave, Los Angeles, CA 90038"/>
<span class="material-symbols-outlined text-success text-[16px]">verified</span>
</div>
</div>
</div>
</div>
</div>
</div>
</section>
<!-- Right Panel: Deal Summary Builder (Cockpit) -->
<aside class="w-full lg:w-[360px] xl:w-[400px] flex-none border-l border-border-dark bg-surface-darker flex flex-col shadow-xl z-20">
<div class="p-5 border-b border-border-dark flex justify-between items-center bg-surface-dark">
<h2 class="text-lg font-bold text-white">Deal Summary</h2>
<span class="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs font-medium border border-primary/20">Drafting</span>
</div>
<div class="flex-1 overflow-y-auto p-5 space-y-6">
<!-- Deal Identity -->
<div class="space-y-4">
<h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Deal Identity</h3>
<div class="space-y-3">
<div>
<label class="block text-xs text-gray-500 mb-1">Deal Name</label>
<input class="w-full bg-background-dark border border-border-dark rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:ring-0" type="text" value="The Highland Apartments Refi"/>
</div>
<div class="grid grid-cols-2 gap-3">
<div>
<label class="block text-xs text-gray-500 mb-1">Asset Type</label>
<select class="w-full bg-background-dark border border-border-dark rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:ring-0">
<option>Multifamily</option>
<option>Office</option>
<option>Industrial</option>
</select>
</div>
<div>
<label class="block text-xs text-gray-500 mb-1">Execution</label>
<select class="w-full bg-background-dark border border-border-dark rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:ring-0">
<option>Bridge</option>
<option>Permanent</option>
<option>Construction</option>
</select>
</div>
</div>
<div>
<label class="block text-xs text-gray-500 mb-1">Sponsor</label>
<div class="flex gap-2">
<input class="flex-1 bg-background-dark border border-border-dark rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:ring-0" type="text" value="Blackstone Real Estate"/>
<button class="p-2 bg-surface-dark border border-border-dark rounded-lg text-gray-400 hover:text-white"><span class="material-symbols-outlined text-[18px]">search</span></button>
</div>
</div>
</div>
</div>
<!-- Metrics Snapshot -->
<div class="space-y-3">
<h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Key Metrics (As-Is)</h3>
<div class="grid grid-cols-3 gap-2">
<div class="bg-surface-dark p-2 rounded-lg border border-border-dark text-center">
<p class="text-[10px] text-gray-500">DSCR</p>
<p class="text-sm font-bold text-white font-mono">1.25x</p>
</div>
<div class="bg-surface-dark p-2 rounded-lg border border-border-dark text-center">
<p class="text-[10px] text-gray-500">LTV</p>
<p class="text-sm font-bold text-white font-mono">65.0%</p>
</div>
<div class="bg-surface-dark p-2 rounded-lg border border-border-dark text-center">
<p class="text-[10px] text-gray-500">Debt Yield</p>
<p class="text-sm font-bold text-white font-mono">8.5%</p>
</div>
<div class="bg-surface-dark p-2 rounded-lg border border-border-dark text-center">
<p class="text-[10px] text-gray-500">Occ.</p>
<p class="text-sm font-bold text-white font-mono">94.5%</p>
</div>
<div class="bg-surface-dark p-2 rounded-lg border border-border-dark text-center col-span-2">
<p class="text-[10px] text-gray-500">Implied Rate</p>
<p class="text-sm font-bold text-white font-mono">5.85% (SOFR + 250)</p>
</div>
</div>
</div>
<!-- Conflicts & Exceptions -->
<div class="space-y-3">
<h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Conflicts &amp; Exceptions</h3>
<div class="space-y-2">
<div class="p-3 bg-warning/5 border border-warning/20 rounded-lg flex gap-3 items-start">
<span class="material-symbols-outlined text-warning text-[20px] mt-0.5">warning</span>
<div class="flex-1">
<p class="text-xs font-medium text-warning-100">Appraisal Variance</p>
<p class="text-[11px] text-gray-400 mt-1">Value differs from OM by 15%.</p>
<button class="mt-2 text-[10px] bg-warning/10 hover:bg-warning/20 text-warning px-2 py-1 rounded border border-warning/20 transition-colors">Review Comps</button>
</div>
</div>
<div class="p-3 bg-surface-dark border border-border-dark rounded-lg flex gap-3 items-start opacity-70">
<span class="material-symbols-outlined text-gray-500 text-[20px] mt-0.5">description</span>
<div class="flex-1">
<p class="text-xs font-medium text-gray-300">Entity Check</p>
<p class="text-[11px] text-gray-500 mt-1">LLC not found in SOS db.</p>
</div>
</div>
</div>
</div>
<!-- Next Best Actions -->
<div class="space-y-3">
<h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Banker Actions</h3>
<div class="grid grid-cols-2 gap-2">
<select class="col-span-2 bg-surface-dark text-xs text-white border border-border-dark rounded p-2">
<option>Assign Underwriter...</option>
<option>Send to Credit Committee</option>
</select>
</div>
</div>
</div>
<!-- Sticky Footer CTA -->
<div class="p-5 border-t border-border-dark bg-surface-darker/95 backdrop-blur z-30">
<button class="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-3 px-4 rounded-lg shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 mb-3">
<span>Create Deal &amp; Open</span>
<span class="material-symbols-outlined text-[18px]">arrow_forward</span>
</button>
<div class="flex gap-2">
<button class="flex-1 py-2 bg-surface-dark hover:bg-border-dark border border-border-dark text-gray-300 text-sm font-medium rounded-lg transition-colors">Save Draft</button>
<button class="flex-1 py-2 bg-transparent hover:text-danger text-gray-500 text-sm font-medium rounded-lg transition-colors">Discard</button>
</div>
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
