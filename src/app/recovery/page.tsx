import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Charge-Off &amp; Recovery Reporting Command Center";
const FONT_LINKS = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "background-light": "#f6f7f8",
                        "background-dark": "#111418",
                        "surface-dark": "#1a2028",
                        "border-dark": "#2f3847",
                        "text-secondary": "#9da8b9"
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "mono": ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"]
                    },
                    borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
                },
            },
        }`;
const STYLES = [
  "/* Custom scrollbar for institutional feel */\n        ::-webkit-scrollbar {\n            width: 8px;\n            height: 8px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #111418; \n        }\n        ::-webkit-scrollbar-thumb {\n            background: #2f3847; \n            border-radius: 4px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #3b4554; \n        }\n        .glass-panel {\n            background: rgba(30, 36, 46, 0.7);\n            backdrop-filter: blur(8px);\n            border: 1px solid rgba(255, 255, 255, 0.08);\n        }\n        .dense-table th {\n            font-size: 0.75rem;\n            text-transform: uppercase;\n            letter-spacing: 0.05em;\n            color: #9da8b9;\n            font-weight: 600;\n            padding: 0.5rem 0.75rem;\n            border-bottom: 1px solid #2f3847;\n            text-align: left;\n        }\n        .dense-table td {\n            font-size: 0.8125rem;\n            color: white;\n            padding: 0.35rem 0.75rem;\n            border-bottom: 1px solid rgba(47, 56, 71, 0.5);\n            white-space: nowrap;\n        }\n        .dense-table tr:last-child td {\n            border-bottom: none;\n        }\n        .kpi-value {\n            font-family: 'Inter', sans-serif;\n            letter-spacing: -0.02em;\n        }"
];
const BODY_HTML = `<!-- Global Header -->
<header class="flex items-center justify-between whitespace-nowrap border-b border-solid border-border-dark bg-[#161b22] px-6 py-2 shrink-0 z-50">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3 text-white">
<div class="size-6 text-primary">
<svg fill="currentColor" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<path clip-rule="evenodd" d="M24 0.757355L47.2426 24L24 47.2426L0.757355 24L24 0.757355ZM21 35.7574V12.2426L9.24264 24L21 35.7574Z" fill-rule="evenodd"></path>
</svg>
</div>
<h2 class="text-white text-lg font-bold leading-tight tracking-[-0.015em]">Buddy</h2>
</div>
<nav class="flex items-center gap-6">
<a class="text-text-secondary hover:text-white text-sm font-medium leading-normal" href="#">Deals</a>
<a class="text-text-secondary hover:text-white text-sm font-medium leading-normal" href="#">Intake</a>
<a class="text-text-secondary hover:text-white text-sm font-medium leading-normal" href="#">Portfolio</a>
<a class="text-text-secondary hover:text-white text-sm font-medium leading-normal" href="#">Committee</a>
<a class="text-text-secondary hover:text-white text-sm font-medium leading-normal" href="#">Reporting</a>
<a class="text-text-secondary hover:text-white text-sm font-medium leading-normal" href="#">Servicing</a>
<a class="text-text-secondary hover:text-white text-sm font-medium leading-normal" href="#">Workout</a>
<a class="text-text-secondary hover:text-white text-sm font-medium leading-normal" href="#">Legal</a>
<a class="text-text-secondary hover:text-white text-sm font-medium leading-normal" href="#">REO</a>
<a class="text-primary text-sm font-bold leading-normal border-b-2 border-primary pb-0.5" href="#">Recovery</a>
</nav>
</div>
<div class="flex items-center gap-4">
<div class="relative">
<span class="material-symbols-outlined absolute left-2 top-1.5 text-text-secondary text-lg">search</span>
<input class="bg-[#282f39] border-none rounded-md pl-8 pr-3 py-1.5 text-sm text-white focus:ring-1 focus:ring-primary w-64 placeholder:text-gray-500" placeholder="Global Search..."/>
</div>
<button class="relative text-text-secondary hover:text-white transition-colors">
<span class="material-symbols-outlined">notifications</span>
<span class="absolute top-0 right-0 size-2 bg-red-500 rounded-full border border-[#161b22]"></span>
</button>
<div class="bg-center bg-no-repeat bg-cover rounded-full size-8 border border-border-dark" data-alt="User Avatar" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuB5V537jYlMwPOXMrJ2wh_ytG-7stYmVJQ250-sv3GqMMq-nJJDzbPQQh72bo55SvSp3uSjZaAIycQKIdJO0aPArG5oDq6J24GXPqR8C7mhdRxfyl5t8SHhZw9zKDs36V5TXI9N9raJmW4P8mXGzgtSSS5XMaH7mjQmQ-2_wn2Jx6aVkPNNaQY1jvE1fvzZHxH0ywA40_MFe3tPG7Ce3IhmrJ3WgiDCjkgeDHs-Ly4E-8owFZy4qcnDDk5YLcsy2kKPyeZN_rFn-Nk");'></div>
</div>
</header>
<!-- Main Command Center Layout -->
<div class="flex flex-1 overflow-hidden">
<!-- LEFT COLUMN: Case Selector & Navigator -->
<aside class="w-[320px] bg-[#13161c] border-r border-border-dark flex flex-col shrink-0">
<!-- Search & Filter -->
<div class="p-4 border-b border-border-dark space-y-3">
<div class="relative">
<span class="material-symbols-outlined absolute left-2 top-2 text-text-secondary">search</span>
<input class="w-full bg-[#1e242e] border border-border-dark rounded-md pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-primary placeholder:text-gray-600" placeholder="Search loan, case, borrower…"/>
</div>
<div class="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
<button class="shrink-0 px-2 py-1 bg-[#282f39] rounded text-xs text-white border border-border-dark flex items-center gap-1">2025 <span class="material-symbols-outlined text-[14px]">expand_more</span></button>
<button class="shrink-0 px-2 py-1 bg-[#282f39] rounded text-xs text-white border border-border-dark flex items-center gap-1">Multifamily <span class="material-symbols-outlined text-[14px]">expand_more</span></button>
<button class="shrink-0 px-2 py-1 bg-primary/20 text-primary border border-primary/30 rounded text-xs flex items-center gap-1">Finalized <span class="material-symbols-outlined text-[14px]">close</span></button>
</div>
</div>
<!-- Case List -->
<div class="flex-1 overflow-y-auto">
<div class="flex flex-col">
<!-- Selected Item -->
<div class="flex flex-col gap-1 p-3 bg-primary/10 border-l-4 border-primary cursor-pointer hover:bg-primary/15 transition-colors">
<div class="flex justify-between items-start">
<span class="text-primary font-mono text-xs font-medium">LN-2023-849</span>
<span class="bg-green-500/20 text-green-400 border border-green-500/30 text-[10px] px-1.5 rounded font-medium uppercase tracking-wide">Finalized</span>
</div>
<p class="text-white text-sm font-semibold truncate">Harbor View Multifamily</p>
<div class="flex justify-between items-center mt-1">
<span class="text-text-secondary text-xs">Loss: 4.7%</span>
<span class="text-text-secondary text-xs">Nov 14, 2025</span>
</div>
</div>
<!-- Other Items -->
<div class="flex flex-col gap-1 p-3 border-b border-border-dark cursor-pointer hover:bg-[#1e242e] transition-colors group">
<div class="flex justify-between items-start">
<span class="text-text-secondary group-hover:text-white font-mono text-xs">LN-2022-104</span>
<span class="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-[10px] px-1.5 rounded font-medium uppercase tracking-wide">Review</span>
</div>
<p class="text-text-secondary group-hover:text-white text-sm font-medium truncate">Aurora Industrial Park</p>
<div class="flex justify-between items-center mt-1">
<span class="text-text-secondary/70 text-xs">Loss: --</span>
<span class="text-text-secondary/70 text-xs">Est. Dec 2025</span>
</div>
</div>
<div class="flex flex-col gap-1 p-3 border-b border-border-dark cursor-pointer hover:bg-[#1e242e] transition-colors group">
<div class="flex justify-between items-start">
<span class="text-text-secondary group-hover:text-white font-mono text-xs">LN-2024-002</span>
<span class="bg-gray-700 text-gray-300 border border-gray-600 text-[10px] px-1.5 rounded font-medium uppercase tracking-wide">Draft</span>
</div>
<p class="text-text-secondary group-hover:text-white text-sm font-medium truncate">Westside Retail Center</p>
<div class="flex justify-between items-center mt-1">
<span class="text-text-secondary/70 text-xs">Loss: --</span>
<span class="text-text-secondary/70 text-xs">Active</span>
</div>
</div>
</div>
</div>
<!-- Reporting Pack Navigator -->
<div class="border-t border-border-dark bg-[#161b22] p-4 shrink-0">
<p class="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3 pl-1">Reporting Sections</p>
<div class="space-y-1">
<button class="w-full text-left px-3 py-1.5 rounded-md text-sm font-medium text-white bg-[#282f39] border border-border-dark flex items-center justify-between">
                        Executive Summary
                        <span class="material-symbols-outlined text-sm text-primary">check_circle</span>
</button>
<button class="w-full text-left px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-white hover:bg-[#1e242e] flex items-center justify-between">
                        Charge-Off &amp; Loss
                        <span class="material-symbols-outlined text-sm text-text-secondary/50">check_circle</span>
</button>
<button class="w-full text-left px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-white hover:bg-[#1e242e] flex items-center justify-between">
                        Recoveries Breakdown
                        <span class="material-symbols-outlined text-sm text-text-secondary/50">check_circle</span>
</button>
<button class="w-full text-left px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-white hover:bg-[#1e242e] flex items-center justify-between">
                        Approvals &amp; Sign-off
                        <span class="material-symbols-outlined text-sm text-yellow-500">pending</span>
</button>
</div>
</div>
<!-- Export Controls -->
<div class="p-4 border-t border-border-dark bg-[#0f1216]">
<div class="glass-panel p-3 rounded-lg border border-border-dark/50">
<div class="flex justify-between items-center mb-2">
<span class="text-[10px] font-mono text-text-secondary">RCV-2025-118 • v1.6</span>
<span class="text-[10px] text-green-400">Ready</span>
</div>
<div class="grid grid-cols-2 gap-2 mb-3">
<button class="flex items-center justify-center gap-1.5 bg-[#282f39] hover:bg-[#323b49] border border-border-dark rounded py-1.5 transition-colors">
<span class="material-symbols-outlined text-[16px] text-red-400">picture_as_pdf</span>
<span class="text-xs font-medium">Memo</span>
</button>
<button class="flex items-center justify-center gap-1.5 bg-[#282f39] hover:bg-[#323b49] border border-border-dark rounded py-1.5 transition-colors">
<span class="material-symbols-outlined text-[16px] text-green-400">table_view</span>
<span class="text-xs font-medium">GL CSV</span>
</button>
</div>
<div class="flex items-center gap-2 text-[10px] text-text-secondary/60">
<div class="size-4 rounded-full bg-gray-600 bg-cover" data-alt="Prepared by M. Chen" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuBOat44nWo2eOvK5ZeLY5UlGzdJlaGNnuxLZ-0imZfE3F0vINVCyb7g7FJO8KVR120fB3_9tSYaanSeKiZn8SyY-iwyKVLL_K6nkFQHi3VSAoSBuEUpkyQxbmvM7OgCqGCWn3KYQMcz9H_Fr7fiQUKzw5M-OfpMBgNNbp-gbVf9DbLUHNcLmpll4VyoS1W-h2c7y4-gpcP4f38dP97FTddIP430FZ8Z2OcPYga6ikJQRHLDF1Iie92IdWYcIJQIaSKs0eZw6FWKHRk");'></div>
<span>Prep: M. Chen • Updated 11:08 AM</span>
</div>
</div>
</div>
</aside>
<!-- CENTER COLUMN: Executive Summary & Truth -->
<main class="flex-1 bg-background-dark overflow-y-auto min-w-[600px] border-r border-border-dark flex flex-col relative">
<!-- Sticky Header inside Main -->
<div class="sticky top-0 z-20 bg-[#111418]/95 backdrop-blur-sm border-b border-border-dark px-6 py-4 flex items-start justify-between">
<div>
<div class="flex items-center gap-3 mb-1">
<h1 class="text-xl font-bold text-white">Harbor View Multifamily</h1>
<span class="bg-green-500/10 text-green-400 border border-green-500/20 text-xs px-2 py-0.5 rounded-full font-medium">FINALIZED</span>
</div>
<div class="flex items-center gap-4 text-xs text-text-secondary">
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">fingerprint</span> LN-2023-849</span>
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">corporate_fare</span> Harbor View Holdings LLC</span>
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">gavel</span> REO Sale</span>
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">event</span> Res: Nov 14, 2025</span>
</div>
</div>
<div class="text-right">
<p class="text-[10px] text-text-secondary uppercase tracking-widest font-semibold">Data Snapshot</p>
<p class="text-xs font-mono text-white mt-0.5">Today, 11:08 AM ET</p>
<p class="text-[10px] text-text-secondary italic">All figures USD</p>
</div>
</div>
<div class="p-6 space-y-6 pb-24">
<!-- Core Resolution KPI Strip -->
<div class="grid grid-cols-4 gap-3">
<div class="glass-panel p-3 rounded-lg">
<p class="text-[10px] text-text-secondary uppercase tracking-wider font-semibold mb-1">UPB at Default</p>
<p class="text-lg font-bold text-white font-mono">$38,600,000</p>
</div>
<div class="glass-panel p-3 rounded-lg">
<p class="text-[10px] text-text-secondary uppercase tracking-wider font-semibold mb-1">Net Recovery</p>
<div class="flex items-end gap-2">
<p class="text-lg font-bold text-green-400 font-mono">$36,785,420</p>
</div>
</div>
<div class="glass-panel p-3 rounded-lg">
<p class="text-[10px] text-text-secondary uppercase tracking-wider font-semibold mb-1">Net Charge-Off</p>
<div class="flex items-end gap-2">
<p class="text-lg font-bold text-red-400 font-mono">($1,814,580)</p>
</div>
</div>
<div class="glass-panel p-3 rounded-lg relative overflow-hidden">
<div class="absolute right-0 top-0 p-1">
<span class="material-symbols-outlined text-text-secondary/20 text-3xl">trending_down</span>
</div>
<p class="text-[10px] text-text-secondary uppercase tracking-wider font-semibold mb-1">Realized Loss</p>
<p class="text-lg font-bold text-white font-mono">4.70%</p>
</div>
</div>
<!-- Charge-Off & Loss Statement -->
<div class="glass-panel rounded-lg overflow-hidden border border-border-dark">
<div class="px-4 py-3 border-b border-border-dark bg-[#1a2028] flex justify-between items-center">
<h3 class="text-sm font-semibold text-white flex items-center gap-2">
<span class="material-symbols-outlined text-primary text-base">account_balance_wallet</span>
                            Charge-Off &amp; Loss Statement
                        </h3>
<button class="text-xs text-primary hover:underline">View Source GL</button>
</div>
<table class="w-full dense-table">
<thead>
<tr>
<th class="w-full">Line Item</th>
<th class="text-right">Amount (USD)</th>
<th class="text-center w-12">Src</th>
</tr>
</thead>
<tbody>
<tr>
<td>UPB at Default</td>
<td class="text-right font-mono text-white">$38,600,000.00</td>
<td class="text-center"><span class="material-symbols-outlined text-[14px] text-primary cursor-pointer">link</span></td>
</tr>
<tr>
<td>Accrued Interest (NPL)</td>
<td class="text-right font-mono text-white">$1,240,000.00</td>
<td class="text-center"><span class="material-symbols-outlined text-[14px] text-primary cursor-pointer">link</span></td>
</tr>
<tr>
<td>Deferred Fees / Unamortized Costs</td>
<td class="text-right font-mono text-white">$185,500.00</td>
<td class="text-center"><span class="material-symbols-outlined text-[14px] text-primary cursor-pointer">link</span></td>
</tr>
<tr class="bg-[#282f39]/50 font-semibold">
<td class="pl-6 italic">Gross Charge-Off Basis</td>
<td class="text-right font-mono text-white">$40,025,500.00</td>
<td class="text-center"></td>
</tr>
<tr>
<td>Less: Net Recoveries</td>
<td class="text-right font-mono text-green-400">($38,210,920.00)</td>
<td class="text-center"><span class="material-symbols-outlined text-[14px] text-primary cursor-pointer">link</span></td>
</tr>
<tr class="bg-red-900/10 border-t-2 border-red-900/30">
<td class="font-bold text-red-200">Net Charge-Off Amount</td>
<td class="text-right font-mono font-bold text-red-300">$1,814,580.00</td>
<td class="text-center"></td>
</tr>
</tbody>
</table>
</div>
<!-- Recoveries Breakdown -->
<div class="glass-panel rounded-lg overflow-hidden border border-border-dark">
<div class="px-4 py-3 border-b border-border-dark bg-[#1a2028] flex justify-between items-center">
<h3 class="text-sm font-semibold text-white flex items-center gap-2">
<span class="material-symbols-outlined text-green-500 text-base">savings</span>
                            Recoveries Breakdown
                        </h3>
</div>
<table class="w-full dense-table">
<thead>
<tr>
<th>Source</th>
<th>Received Date</th>
<th>Ref ID</th>
<th class="text-right">Amount</th>
<th class="text-center">Evidence</th>
</tr>
</thead>
<tbody>
<tr>
<td>REO Sale Proceeds (Gross)</td>
<td class="text-text-secondary">Nov 14, 2025</td>
<td class="text-text-secondary font-mono text-xs">WIRE-9928</td>
<td class="text-right font-mono text-white">$39,500,000.00</td>
<td class="text-center"><span class="material-symbols-outlined text-[14px] text-primary cursor-pointer">description</span></td>
</tr>
<tr>
<td>Guarantor Payment</td>
<td class="text-text-secondary">Oct 02, 2025</td>
<td class="text-text-secondary font-mono text-xs">CHK-1004</td>
<td class="text-right font-mono text-white">$250,000.00</td>
<td class="text-center"><span class="material-symbols-outlined text-[14px] text-primary cursor-pointer">description</span></td>
</tr>
<tr>
<td>Insurance Claim (Fire)</td>
<td class="text-text-secondary">Sep 15, 2025</td>
<td class="text-text-secondary font-mono text-xs">CLM-7732</td>
<td class="text-right font-mono text-white">$85,000.00</td>
<td class="text-center"><span class="material-symbols-outlined text-[14px] text-primary cursor-pointer">description</span></td>
</tr>
<tr class="bg-[#282f39]/50 font-semibold border-t border-border-dark">
<td>Total Gross Recoveries</td>
<td></td>
<td></td>
<td class="text-right font-mono text-green-400">$39,835,000.00</td>
<td></td>
</tr>
</tbody>
</table>
</div>
<!-- Expenses Table (Condensed) -->
<div class="glass-panel rounded-lg overflow-hidden border border-border-dark">
<div class="px-4 py-3 border-b border-border-dark bg-[#1a2028]">
<h3 class="text-sm font-semibold text-white flex items-center gap-2">
<span class="material-symbols-outlined text-red-400 text-base">payments</span>
                            Expenses / Carry Costs
                        </h3>
</div>
<table class="w-full dense-table">
<thead>
<tr>
<th>Type</th>
<th>Vendor</th>
<th>Period</th>
<th class="text-right">Amount</th>
</tr>
</thead>
<tbody>
<tr>
<td>Broker Commission (Sale)</td>
<td>CBRE Capital</td>
<td class="text-text-secondary">One-time</td>
<td class="text-right font-mono text-white">$1,185,000.00</td>
</tr>
<tr>
<td>Legal Fees (Foreclosure)</td>
<td>Latham &amp; Watkins</td>
<td class="text-text-secondary">2023-2025</td>
<td class="text-right font-mono text-white">$245,000.00</td>
</tr>
<tr>
<td>Property Management</td>
<td>Greystar</td>
<td class="text-text-secondary">May-Nov '25</td>
<td class="text-right font-mono text-white">$112,500.00</td>
</tr>
<tr>
<td>Outstanding Prop Taxes</td>
<td>City of Boston</td>
<td class="text-text-secondary">FY 2024</td>
<td class="text-right font-mono text-white">$81,580.00</td>
</tr>
<tr class="bg-[#282f39]/50 font-semibold border-t border-border-dark">
<td>Total Expenses</td>
<td></td>
<td></td>
<td class="text-right font-mono text-red-300">($1,624,080.00)</td>
</tr>
</tbody>
</table>
</div>
</div>
</main>
<!-- RIGHT COLUMN: Logic & Sign-off -->
<aside class="w-[400px] bg-[#13161c] border-l border-border-dark flex flex-col shrink-0 overflow-y-auto">
<!-- Reserve Timeline -->
<div class="p-4 border-b border-border-dark">
<div class="flex items-center justify-between mb-3">
<h3 class="text-sm font-semibold text-white">Reserve / CECL Timeline</h3>
<span class="text-[10px] text-text-secondary">Model: ACL-v4.2</span>
</div>
<div class="relative pl-4 border-l border-border-dark space-y-6 my-2">
<!-- Timeline Item -->
<div class="relative">
<div class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-green-500 border border-[#13161c]"></div>
<div class="flex justify-between items-start">
<div>
<p class="text-xs font-bold text-white">Resolution &amp; Release</p>
<p class="text-[10px] text-text-secondary">Nov 2025</p>
</div>
<div class="text-right">
<p class="text-xs font-mono text-green-400">($1.9M)</p>
<p class="text-[10px] text-text-secondary">Full Release</p>
</div>
</div>
</div>
<!-- Timeline Item -->
<div class="relative">
<div class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-primary border border-[#13161c]"></div>
<div class="flex justify-between items-start">
<div>
<p class="text-xs font-bold text-white">Q3 2025 Provision</p>
<p class="text-[10px] text-text-secondary">Sep 30, 2025</p>
</div>
<div class="text-right">
<p class="text-xs font-mono text-white">$1.9M</p>
<p class="text-[10px] text-text-secondary">Specific Reserve</p>
</div>
</div>
</div>
<!-- Timeline Item -->
<div class="relative">
<div class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-gray-600 border border-[#13161c]"></div>
<div class="flex justify-between items-start">
<div>
<p class="text-xs font-bold text-text-secondary">Q2 2025 CECL</p>
<p class="text-[10px] text-text-secondary">Jun 30, 2025</p>
</div>
<div class="text-right">
<p class="text-xs font-mono text-text-secondary">$450K</p>
<p class="text-[10px] text-text-secondary">Pool Reserve</p>
</div>
</div>
</div>
</div>
</div>
<!-- Investor Waterfall -->
<div class="p-4 border-b border-border-dark">
<div class="flex items-center justify-between mb-3">
<h3 class="text-sm font-semibold text-white">Investor Waterfall</h3>
<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">Equity Multiple: 0.95x</span>
</div>
<div class="bg-[#1a2028] rounded border border-border-dark p-2 text-xs">
<div class="flex justify-between py-1 border-b border-border-dark/50">
<span class="text-text-secondary">Net Distributable</span>
<span class="font-mono text-white">$38,210,920</span>
</div>
<div class="flex justify-between py-1 pl-2 text-text-secondary/80">
<span>↳ Senior Lender Payoff</span>
<span class="font-mono">($28,500,000)</span>
</div>
<div class="flex justify-between py-1 pl-2 text-text-secondary/80">
<span>↳ Mezz Lender Payoff</span>
<span class="font-mono">($5,000,000)</span>
</div>
<div class="flex justify-between py-1 border-t border-border-dark/50 font-medium bg-[#282f39]/30 mt-1">
<span class="text-white">Net to Equity</span>
<span class="font-mono text-white">$4,710,920</span>
</div>
<div class="flex justify-between py-1 pl-2 text-text-secondary/80">
<span>↳ LP Pref (8%)</span>
<span class="font-mono text-white">$4,710,920</span>
</div>
<div class="flex justify-between py-1 pl-2 text-text-secondary/50 italic">
<span>↳ GP Promote</span>
<span class="font-mono">$0.00</span>
</div>
</div>
<p class="text-[10px] text-red-400 mt-2 text-right">Variance to Underwriting: -18.4%</p>
</div>
<!-- GL Posting Schedules -->
<div class="p-4 border-b border-border-dark">
<h3 class="text-sm font-semibold text-white mb-3">GL Posting &amp; Schedules</h3>
<div class="space-y-2">
<div class="flex items-center justify-between p-2 rounded bg-[#1e242e] border border-border-dark">
<div class="flex items-center gap-2">
<div class="bg-blue-500/20 text-blue-400 p-1 rounded"><span class="material-symbols-outlined text-[16px]">receipt_long</span></div>
<div>
<p class="text-xs font-medium text-white">Charge-Off Entry</p>
<p class="text-[10px] text-text-secondary">JE-2025-884</p>
</div>
</div>
<button class="text-xs bg-black/40 hover:bg-black/60 text-white px-2 py-1 rounded border border-border-dark">Export</button>
</div>
<div class="flex items-center justify-between p-2 rounded bg-[#1e242e] border border-border-dark">
<div class="flex items-center gap-2">
<div class="bg-green-500/20 text-green-400 p-1 rounded"><span class="material-symbols-outlined text-[16px]">account_balance</span></div>
<div>
<p class="text-xs font-medium text-white">Recovery Cash</p>
<p class="text-[10px] text-text-secondary">CR-2025-102</p>
</div>
</div>
<button class="text-xs bg-black/40 hover:bg-black/60 text-white px-2 py-1 rounded border border-border-dark">Export</button>
</div>
</div>
</div>
<!-- Approvals Audit -->
<div class="p-4 pb-24">
<h3 class="text-sm font-semibold text-white mb-3">Approvals Chain</h3>
<div class="space-y-3 relative">
<div class="absolute left-3 top-2 bottom-2 w-0.5 bg-border-dark"></div>
<div class="relative pl-8">
<div class="absolute left-1.5 top-1 size-3.5 rounded-full bg-green-500 border-2 border-[#13161c]"></div>
<p class="text-xs font-medium text-white">Finance Controller</p>
<p class="text-[10px] text-text-secondary">Signed by S. Johnson • Nov 15, 9:00 AM</p>
</div>
<div class="relative pl-8">
<div class="absolute left-1.5 top-1 size-3.5 rounded-full bg-green-500 border-2 border-[#13161c]"></div>
<p class="text-xs font-medium text-white">Head of Special Assets</p>
<p class="text-[10px] text-text-secondary">Signed by D. Miller • Nov 15, 2:30 PM</p>
</div>
<div class="relative pl-8">
<div class="absolute left-1.5 top-1 size-3.5 rounded-full bg-green-500 border-2 border-[#13161c]"></div>
<p class="text-xs font-medium text-white">Chief Credit Officer</p>
<p class="text-[10px] text-text-secondary">Signed by A. Rossi • Nov 16, 10:15 AM</p>
</div>
<div class="relative pl-8 opacity-50">
<div class="absolute left-1.5 top-1 size-3.5 rounded-full bg-gray-600 border-2 border-[#13161c]"></div>
<p class="text-xs font-medium text-white">External Audit Review</p>
<p class="text-[10px] text-text-secondary">Pending (Q4 Cycle)</p>
</div>
</div>
</div>
</aside>
</div>
<!-- Sticky Bottom Action Bar -->
<div class="fixed bottom-0 left-0 right-0 bg-[#161b22] border-t border-border-dark py-3 px-6 z-50 flex justify-between items-center shadow-2xl">
<div class="flex items-center gap-4">
<button class="text-text-secondary hover:text-white flex items-center gap-1.5 text-xs font-medium transition-colors">
<span class="material-symbols-outlined text-[16px]">history</span>
                Audit Trail
            </button>
<div class="h-4 w-px bg-border-dark"></div>
<p class="text-[10px] text-text-secondary">Last saved automatically 2 mins ago</p>
</div>
<div class="flex items-center gap-3">
<button class="px-4 py-2 rounded-md bg-transparent border border-red-900/50 text-red-400 hover:bg-red-900/20 hover:border-red-800 text-sm font-medium transition-colors">
                Reopen (Admin)
            </button>
<button class="px-4 py-2 rounded-md bg-[#282f39] hover:bg-[#323b49] text-white text-sm font-medium border border-border-dark transition-colors">
                Lock Snapshot
            </button>
<button class="px-4 py-2 rounded-md bg-[#282f39] hover:bg-[#323b49] text-white text-sm font-medium border border-border-dark transition-colors">
                Request Review
            </button>
<button class="px-5 py-2 rounded-md bg-primary hover:bg-blue-600 text-white text-sm font-bold shadow-lg shadow-blue-900/20 flex items-center gap-2 transition-colors">
<span class="material-symbols-outlined text-[18px]">check_circle</span>
                Finalize Reporting Pack
            </button>
</div>
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
