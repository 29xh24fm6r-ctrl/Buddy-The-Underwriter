import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Credit Memorandum Template";
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
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"]
                    },
                    borderRadius: {"DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem"},
                },
            },
        }`;
const STYLES = [
  "/* Print Simulation Styles */\n        @media print {\n            body {\n                background-color: white !important;\n                -webkit-print-color-adjust: exact;\n                print-color-adjust: exact;\n            }\n            .no-print {\n                display: none !important;\n            }\n            .print-container {\n                box-shadow: none !important;\n                margin: 0 !important;\n                width: 100% !important;\n                max-width: none !important;\n                padding: 0 !important;\n            }\n            .page-break {\n                page-break-before: always;\n            }\n        }\n        \n        .paper-shadow {\n            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.05);\n        }"
];
const BODY_HTML = `<!-- Toolbar (App Chrome - No Print) -->
<div class="no-print fixed top-0 left-0 right-0 z-50 h-16 bg-white dark:bg-[#1a2634] border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 shadow-sm">
<div class="flex items-center gap-4">
<div class="flex items-center gap-2 text-primary">
<span class="material-symbols-outlined">description</span>
<span class="font-bold text-lg text-[#111418] dark:text-white">Credit Memo Preview</span>
</div>
<span class="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs font-medium text-gray-500 dark:text-gray-300">Read Only</span>
</div>
<div class="flex gap-3">
<button class="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 text-[#111418]">
<span class="material-symbols-outlined text-[18px]">edit</span>
                Edit Data
            </button>
<button class="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded text-sm font-bold hover:bg-blue-600 shadow-sm" onclick="window.print()">
<span class="material-symbols-outlined text-[18px]">print</span>
                Print / PDF
            </button>
</div>
</div>
<!-- Main Workspace -->
<div class="flex justify-center pt-24 pb-20 min-h-screen">
<!-- The "Paper" Document -->
<div class="print-container paper-shadow bg-white w-full max-w-[900px] min-h-[1100px] p-[40px] relative mx-4">
<!-- A. Top Document Header Block -->
<header class="border-b-2 border-primary mb-6 pb-4">
<div class="flex justify-between items-start mb-6">
<div class="flex flex-col gap-1">
<div class="flex items-center gap-2 text-[#111418] mb-1">
<div class="size-6 text-primary">
<svg fill="none" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<path d="M42.4379 44C42.4379 44 36.0744 33.9038 41.1692 24C46.8624 12.9336 42.2078 4 42.2078 4L7.01134 4C7.01134 4 11.6577 12.932 5.96912 23.9969C0.876273 33.9029 7.27094 44 7.27094 44L42.4379 44Z" fill="currentColor"></path>
</svg>
</div>
<h2 class="text-xl font-bold tracking-tight">Buddy – The Underwriter</h2>
</div>
<h1 class="text-2xl font-bold text-gray-900 uppercase tracking-tight">Credit Memorandum</h1>
</div>
<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-right">
<span class="text-gray-500">Date:</span>
<span class="font-medium">October 24, 2023</span>
<span class="text-gray-500">Prepared By:</span>
<span class="font-medium">John Smith (Senior UW)</span>
<span class="text-gray-500">Version:</span>
<span class="font-medium">Final Draft</span>
<span class="text-gray-500">Document ID:</span>
<span class="font-medium font-mono">CM-2023-8492</span>
</div>
</div>
<!-- Deal Core Info -->
<div class="bg-gray-50 p-4 border border-gray-100 rounded-sm">
<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
<div>
<p class="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Transaction Name</p>
<h2 class="text-lg font-bold text-[#111418]">Riverview Apartments - Refinance</h2>
</div>
<div>
<p class="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Borrower / Sponsor</p>
<p class="text-base font-medium text-[#111418]">Riverview Holdings LLC / Beacon Capital Partners</p>
</div>
</div>
<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
<div>
<p class="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Collateral Address</p>
<div class="flex items-center gap-1">
<span class="material-symbols-outlined text-sm text-gray-400">location_on</span>
<p class="text-sm text-[#111418]">123 Main St, Springfield, IL 62704</p>
</div>
</div>
<div>
<p class="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Request Summary</p>
<p class="text-sm text-gray-700 leading-snug">Refinance of existing construction debt with $15.5MM permanent financing, including $500k cash-out for immediate CapEx improvements.</p>
</div>
</div>
</div>
</header>
<!-- B. Executive Summary -->
<section class="mb-8">
<h3 class="text-primary text-xs font-bold uppercase tracking-wider border-b border-gray-200 pb-1 mb-3">1. Executive Summary</h3>
<div class="flex flex-col md:flex-row gap-6">
<div class="flex-1 text-sm text-gray-800 leading-relaxed text-justify">
<p class="mb-3">
                            The Borrower, Riverview Holdings LLC, requests a $15,500,000 term loan to refinance existing construction debt on Riverview Apartments, a 120-unit Class A multifamily complex in Springfield, IL. The property achieved Certificate of Occupancy in January 2023 and has reached stabilized occupancy of 94% as of September 2023.
                        </p>
<p class="mb-3">
                            Sponsorship is provided by Beacon Capital Partners, a reputable local developer with over 20 years of experience in the Springfield market and a portfolio valued in excess of $150MM. The requested loan represents a 65% LTV on the "As-Is" appraised value of $23.8MM.
                        </p>
<p>
                            Historical operating performance during lease-up has been strong, with rental rates achieving 5% above pro-forma. The subject property benefits from superior amenities compared to direct competitors and proximity to the new medical district. The underwritten DSCR is 1.35x based on T-3 annualized income and proposed debt service, providing a comfortable cushion against market volatility.
                        </p>
</div>
<!-- Fact Box -->
<div class="w-full md:w-[280px] bg-white border border-gray-200 shadow-sm rounded-sm overflow-hidden flex-shrink-0">
<div class="bg-gray-100 px-3 py-2 border-b border-gray-200">
<h4 class="text-xs font-bold uppercase text-gray-700">Key Transaction Metrics</h4>
</div>
<div class="p-0">
<div class="grid grid-cols-2 border-b border-gray-100 last:border-0">
<div class="p-2 text-xs text-gray-500 font-medium bg-gray-50/50">Loan Amount</div>
<div class="p-2 text-xs font-bold text-right font-mono">$15,500,000</div>
</div>
<div class="grid grid-cols-2 border-b border-gray-100 last:border-0">
<div class="p-2 text-xs text-gray-500 font-medium bg-gray-50/50">Product Type</div>
<div class="p-2 text-xs font-bold text-right">Perm / CRE</div>
</div>
<div class="grid grid-cols-2 border-b border-gray-100 last:border-0">
<div class="p-2 text-xs text-gray-500 font-medium bg-gray-50/50">Term / Amort</div>
<div class="p-2 text-xs font-bold text-right">10 Yr / 30 Yr</div>
</div>
<div class="grid grid-cols-2 border-b border-gray-100 last:border-0">
<div class="p-2 text-xs text-gray-500 font-medium bg-gray-50/50">Int. Rate</div>
<div class="p-2 text-xs font-bold text-right">6.75% Fixed</div>
</div>
<div class="grid grid-cols-2 border-b border-gray-100 last:border-0">
<div class="p-2 text-xs text-gray-500 font-medium bg-gray-50/50">LTV (As-Is)</div>
<div class="p-2 text-xs font-bold text-right text-blue-700">65.0%</div>
</div>
<div class="grid grid-cols-2 border-b border-gray-100 last:border-0">
<div class="p-2 text-xs text-gray-500 font-medium bg-gray-50/50">DSCR (UW)</div>
<div class="p-2 text-xs font-bold text-right text-green-700">1.35x</div>
</div>
<div class="grid grid-cols-2 border-b border-gray-100 last:border-0">
<div class="p-2 text-xs text-gray-500 font-medium bg-gray-50/50">Recourse</div>
<div class="p-2 text-xs font-bold text-right">Carve-out Only</div>
</div>
</div>
</div>
</div>
</section>
<!-- C. Transaction Overview -->
<section class="mb-8">
<h3 class="text-primary text-xs font-bold uppercase tracking-wider border-b border-gray-200 pb-1 mb-3">2. Transaction Overview</h3>
<ul class="list-disc list-inside text-sm text-gray-800 mb-4 pl-2 space-y-1">
<li>Payoff of existing construction facility held by Regional Bank ($14.2MM).</li>
<li>Fund $500k into immediate repair reserve for parking lot resurfacing and clubhouse upgrades.</li>
<li>Return approx. $250k of equity to Sponsor (post-closing costs).</li>
</ul>
<!-- Sources & Uses Table -->
<div class="overflow-hidden border border-gray-200 rounded-sm">
<table class="w-full text-sm text-left">
<thead class="bg-gray-100 text-xs uppercase font-semibold text-gray-700">
<tr>
<th class="px-3 py-2 border-r border-gray-200 w-1/2">Sources of Funds</th>
<th class="px-3 py-2 text-right w-[15%]">Amount</th>
<th class="px-3 py-2 text-right w-[10%]">%</th>
<th class="px-3 py-2 border-r border-l border-gray-200 w-1/2">Uses of Funds</th>
<th class="px-3 py-2 text-right w-[15%]">Amount</th>
<th class="px-3 py-2 text-right w-[10%]">%</th>
</tr>
</thead>
<tbody class="divide-y divide-gray-200">
<tr>
<td class="px-3 py-2 font-medium">Proposed Senior Loan</td>
<td class="px-3 py-2 text-right font-mono">$15,500,000</td>
<td class="px-3 py-2 text-right text-gray-500">72%</td>
<td class="px-3 py-2 border-l border-gray-200">Payoff Existing Debt</td>
<td class="px-3 py-2 text-right font-mono">$14,200,000</td>
<td class="px-3 py-2 text-right text-gray-500">66%</td>
</tr>
<tr>
<td class="px-3 py-2 font-medium">Sponsor Equity (Rollover)</td>
<td class="px-3 py-2 text-right font-mono">$6,050,000</td>
<td class="px-3 py-2 text-right text-gray-500">28%</td>
<td class="px-3 py-2 border-l border-gray-200">Return of Equity</td>
<td class="px-3 py-2 text-right font-mono">$6,500,000</td>
<td class="px-3 py-2 text-right text-gray-500">30%</td>
</tr>
<tr>
<td class="px-3 py-2 font-medium"></td>
<td class="px-3 py-2 text-right font-mono"></td>
<td class="px-3 py-2 text-right text-gray-500"></td>
<td class="px-3 py-2 border-l border-gray-200">Closing Costs &amp; Fees</td>
<td class="px-3 py-2 text-right font-mono">$350,000</td>
<td class="px-3 py-2 text-right text-gray-500">2%</td>
</tr>
<tr>
<td class="px-3 py-2 font-medium"></td>
<td class="px-3 py-2 text-right font-mono"></td>
<td class="px-3 py-2 text-right text-gray-500"></td>
<td class="px-3 py-2 border-l border-gray-200">CapEx Reserves</td>
<td class="px-3 py-2 text-right font-mono">$500,000</td>
<td class="px-3 py-2 text-right text-gray-500">2%</td>
</tr>
<tr class="bg-gray-50 font-bold border-t border-gray-300">
<td class="px-3 py-2">Total Sources</td>
<td class="px-3 py-2 text-right font-mono">$21,550,000</td>
<td class="px-3 py-2 text-right">100%</td>
<td class="px-3 py-2 border-l border-gray-300">Total Uses</td>
<td class="px-3 py-2 text-right font-mono">$21,550,000</td>
<td class="px-3 py-2 text-right">100%</td>
</tr>
</tbody>
</table>
</div>
</section>
<!-- D. Borrower & Sponsor -->
<section class="mb-8">
<h3 class="text-primary text-xs font-bold uppercase tracking-wider border-b border-gray-200 pb-1 mb-3">3. Borrower &amp; Sponsor</h3>
<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
<div>
<h4 class="text-sm font-bold text-gray-900 mb-2">Sponsor Background</h4>
<p class="text-sm text-gray-800 text-justify mb-4">
                            The Key Principal is Michael Davis, managing partner of Beacon Capital Partners. Mr. Davis has 22 years of real estate investment experience. Beacon Capital Partners currently owns and manages 1,200 multifamily units across Illinois and Indiana. The sponsor has no history of foreclosure, bankruptcy, or litigation.
                        </p>
</div>
<div>
<h4 class="text-sm font-bold text-gray-900 mb-2">Guarantor Financial Summary</h4>
<table class="w-full text-xs text-left border border-gray-200">
<thead class="bg-gray-100">
<tr>
<th class="px-2 py-1 border-b">Metric</th>
<th class="px-2 py-1 border-b text-right">Value</th>
<th class="px-2 py-1 border-b text-right">Covenant</th>
</tr>
</thead>
<tbody class="divide-y divide-gray-100">
<tr>
<td class="px-2 py-1 font-medium">Net Worth</td>
<td class="px-2 py-1 text-right font-mono">$45.2MM</td>
<td class="px-2 py-1 text-right text-gray-500">$15.5MM min</td>
</tr>
<tr>
<td class="px-2 py-1 font-medium">Liquidity</td>
<td class="px-2 py-1 text-right font-mono">$4.8MM</td>
<td class="px-2 py-1 text-right text-gray-500">$1.55MM min</td>
</tr>
<tr>
<td class="px-2 py-1 font-medium">Contingent Liabilities</td>
<td class="px-2 py-1 text-right font-mono">$12.1MM</td>
<td class="px-2 py-1 text-right text-gray-500">N/A</td>
</tr>
</tbody>
</table>
</div>
</div>
</section>
<!-- E. Collateral & Market -->
<section class="mb-8">
<h3 class="text-primary text-xs font-bold uppercase tracking-wider border-b border-gray-200 pb-1 mb-3">4. Collateral &amp; Market</h3>
<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
<div class="md:col-span-2">
<h4 class="text-sm font-bold text-gray-900 mb-1">Property Overview</h4>
<p class="text-sm text-gray-800 mb-3">
                            Riverview Apartments is a garden-style community built in 2022, comprising 5 three-story buildings on 8.5 acres. Amenities include a clubhouse, pool, fitness center, and dog park. The property unit mix consists of 40 1BR, 60 2BR, and 20 3BR units.
                        </p>
<h4 class="text-sm font-bold text-gray-900 mb-1">Market Commentary</h4>
<p class="text-sm text-gray-800">
                            The Springfield multifamily market remains stable with vacancy rates averaging 4.2%. Rent growth has slowed to 2.1% YoY but demand remains robust due to limited new supply in the immediate submarket.
                        </p>
</div>
<div>
<h4 class="text-sm font-bold text-gray-900 mb-2">Valuation Summary</h4>
<table class="w-full text-xs border border-gray-200">
<tbody class="divide-y divide-gray-100">
<tr>
<td class="px-2 py-1 bg-gray-50 text-gray-500">Appraiser</td>
<td class="px-2 py-1 text-right">CBRE</td>
</tr>
<tr>
<td class="px-2 py-1 bg-gray-50 text-gray-500">Date</td>
<td class="px-2 py-1 text-right">Sep 15, 2023</td>
</tr>
<tr>
<td class="px-2 py-1 bg-gray-50 text-gray-500">As-Is Value</td>
<td class="px-2 py-1 text-right font-mono font-bold">$23,800,000</td>
</tr>
<tr>
<td class="px-2 py-1 bg-gray-50 text-gray-500">Cap Rate</td>
<td class="px-2 py-1 text-right font-mono">5.50%</td>
</tr>
<tr>
<td class="px-2 py-1 bg-gray-50 text-gray-500">Stabilized</td>
<td class="px-2 py-1 text-right font-mono">$24,500,000</td>
</tr>
</tbody>
</table>
</div>
</div>
<!-- 3rd Party Checklist -->
<div class="flex gap-4 border-t border-gray-100 pt-3">
<div class="flex items-center gap-2 text-xs">
<span class="material-symbols-outlined text-green-600 text-base">check_circle</span>
<span class="font-medium">Appraisal (Received)</span>
</div>
<div class="flex items-center gap-2 text-xs">
<span class="material-symbols-outlined text-green-600 text-base">check_circle</span>
<span class="font-medium">Phase I ESA (Clean)</span>
</div>
<div class="flex items-center gap-2 text-xs">
<span class="material-symbols-outlined text-green-600 text-base">check_circle</span>
<span class="font-medium">PCA (Immediate Repairs &lt; $50k)</span>
</div>
</div>
</section>
<div class="page-break h-8"></div> <!-- Visual Spacer for "page break" feel -->
<!-- F. Financial Analysis -->
<section class="mb-8">
<h3 class="text-primary text-xs font-bold uppercase tracking-wider border-b border-gray-200 pb-1 mb-3">5. Financial Analysis</h3>
<table class="w-full text-sm text-left border border-gray-200 mb-6">
<thead class="bg-gray-100 text-xs font-semibold text-gray-700 uppercase">
<tr>
<th class="px-3 py-2 w-1/3">Line Item</th>
<th class="px-3 py-2 text-right w-1/6">T-12 Actual</th>
<th class="px-3 py-2 text-right w-1/6">Year 1 Pro Forma</th>
<th class="px-3 py-2 text-right w-1/6">UW Base Case</th>
<th class="px-3 py-2 text-right w-1/6">Variance (UW vs T12)</th>
</tr>
</thead>
<tbody class="divide-y divide-gray-200">
<tr class="even:bg-gray-50">
<td class="px-3 py-2 text-gray-600">Gross Potential Rent</td>
<td class="px-3 py-2 text-right font-mono">$2,450,000</td>
<td class="px-3 py-2 text-right font-mono">$2,572,500</td>
<td class="px-3 py-2 text-right font-mono font-medium">$2,550,000</td>
<td class="px-3 py-2 text-right font-mono text-green-600">+4.1%</td>
</tr>
<tr class="even:bg-gray-50">
<td class="px-3 py-2 text-gray-600">Vacancy &amp; Credit Loss</td>
<td class="px-3 py-2 text-right font-mono">($147,000)</td>
<td class="px-3 py-2 text-right font-mono">($128,625)</td>
<td class="px-3 py-2 text-right font-mono font-medium">($127,500)</td>
<td class="px-3 py-2 text-right font-mono text-gray-400">5.0%</td>
</tr>
<tr class="even:bg-gray-50 font-medium bg-gray-50">
<td class="px-3 py-2">Effective Gross Income</td>
<td class="px-3 py-2 text-right font-mono">$2,303,000</td>
<td class="px-3 py-2 text-right font-mono">$2,443,875</td>
<td class="px-3 py-2 text-right font-mono font-bold">$2,422,500</td>
<td class="px-3 py-2 text-right font-mono"></td>
</tr>
<tr class="even:bg-gray-50">
<td class="px-3 py-2 text-gray-600">Total Expenses</td>
<td class="px-3 py-2 text-right font-mono">($921,200)</td>
<td class="px-3 py-2 text-right font-mono">($950,000)</td>
<td class="px-3 py-2 text-right font-mono font-medium">($972,500)</td>
<td class="px-3 py-2 text-right font-mono text-red-600">+5.5%</td>
</tr>
<tr class="even:bg-gray-50 font-bold bg-blue-50/50 border-t border-blue-100 text-gray-900">
<td class="px-3 py-2">Net Operating Income (NOI)</td>
<td class="px-3 py-2 text-right font-mono">$1,381,800</td>
<td class="px-3 py-2 text-right font-mono">$1,493,875</td>
<td class="px-3 py-2 text-right font-mono">$1,450,000</td>
<td class="px-3 py-2 text-right font-mono text-green-600">+4.9%</td>
</tr>
<tr class="even:bg-gray-50">
<td class="px-3 py-2 text-gray-600 italic">Proposed Debt Service</td>
<td class="px-3 py-2 text-right font-mono italic">-</td>
<td class="px-3 py-2 text-right font-mono italic">($1,075,000)</td>
<td class="px-3 py-2 text-right font-mono italic font-medium">($1,075,000)</td>
<td class="px-3 py-2 text-right font-mono"></td>
</tr>
<tr class="even:bg-gray-50 font-bold">
<td class="px-3 py-2">Debt Service Coverage (DSCR)</td>
<td class="px-3 py-2 text-right font-mono">-</td>
<td class="px-3 py-2 text-right font-mono">1.39x</td>
<td class="px-3 py-2 text-right font-mono text-primary">1.35x</td>
<td class="px-3 py-2 text-right font-mono"></td>
</tr>
</tbody>
</table>
<div class="bg-gray-50 p-3 rounded-sm border border-gray-200">
<h4 class="text-xs font-bold text-gray-700 uppercase mb-2">Sensitivity Analysis: Interest Rate Impact</h4>
<div class="grid grid-cols-5 gap-2 text-center text-xs">
<div class="p-2 bg-white rounded border border-gray-200">
<div class="text-gray-500 mb-1">Rate -1.0% (5.75%)</div>
<div class="font-mono font-bold text-green-600">1.48x DSCR</div>
</div>
<div class="p-2 bg-white rounded border border-gray-200 ring-1 ring-primary/20">
<div class="text-gray-500 mb-1">Base (6.75%)</div>
<div class="font-mono font-bold text-primary">1.35x DSCR</div>
</div>
<div class="p-2 bg-white rounded border border-gray-200">
<div class="text-gray-500 mb-1">Rate +1.0% (7.75%)</div>
<div class="font-mono font-bold text-yellow-600">1.24x DSCR</div>
</div>
<div class="p-2 bg-white rounded border border-gray-200">
<div class="text-gray-500 mb-1">Rate +2.0% (8.75%)</div>
<div class="font-mono font-bold text-orange-600">1.14x DSCR</div>
</div>
<div class="p-2 bg-white rounded border border-gray-200">
<div class="text-gray-500 mb-1">Breakeven Rate</div>
<div class="font-mono font-bold text-red-600">10.35%</div>
</div>
</div>
</div>
</section>
<!-- G. Risk Factors -->
<section class="mb-8">
<h3 class="text-primary text-xs font-bold uppercase tracking-wider border-b border-gray-200 pb-1 mb-3">6. Risk Factors &amp; Mitigants</h3>
<table class="w-full text-sm text-left border border-gray-200">
<thead class="bg-gray-100 text-xs font-semibold text-gray-700">
<tr>
<th class="px-3 py-2 w-[30%]">Risk Factor</th>
<th class="px-3 py-2 w-[10%]">Level</th>
<th class="px-3 py-2 w-[60%]">Mitigant / Credit Strength</th>
</tr>
</thead>
<tbody class="divide-y divide-gray-200">
<tr class="bg-white">
<td class="px-3 py-2 font-medium">Limited Operating History</td>
<td class="px-3 py-2"><span class="bg-yellow-100 text-yellow-800 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">Medium</span></td>
<td class="px-3 py-2 text-gray-700">Property recently stabilized. However, lease-up velocity was 15 units/month, exceeding market norms. Sponsor is an experienced local operator.</td>
</tr>
<tr class="bg-gray-50">
<td class="px-3 py-2 font-medium">Interest Rate Volatility</td>
<td class="px-3 py-2"><span class="bg-orange-100 text-orange-800 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">High</span></td>
<td class="px-3 py-2 text-gray-700">Borrower is purchasing an interest rate cap at closing for the first 3 years of the term. Underwriting stresses rate by +200bps and DSCR remains &gt; 1.10x.</td>
</tr>
<tr class="bg-white">
<td class="px-3 py-2 font-medium">New Supply in Market</td>
<td class="px-3 py-2"><span class="bg-green-100 text-green-800 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">Low</span></td>
<td class="px-3 py-2 text-gray-700">Only one other competitive project is in permitting stage within 3-mile radius. Market absorption remains positive.</td>
</tr>
</tbody>
</table>
</section>
<!-- I. Proposed Terms -->
<section class="mb-8">
<h3 class="text-primary text-xs font-bold uppercase tracking-wider border-b border-gray-200 pb-1 mb-3">7. Conditions Precedent</h3>
<div class="bg-gray-50 border border-gray-200 rounded-sm p-4">
<ul class="list-disc list-outside text-sm text-gray-800 space-y-1 pl-4">
<li>Receipt and satisfactory review of final Title Policy and Survey.</li>
<li>Evidence of Hazard and Liability Insurance naming Bank as mortgagee.</li>
<li>Execution of all Loan Documents including Guaranty Agreements.</li>
<li>Establishment of a deposit account relationship with the Bank (Operating Account).</li>
<li>Receipt of zoning compliance letter from City of Springfield.</li>
</ul>
</div>
</section>
<!-- J. Approvals -->
<section class="mt-8 pt-4 border-t-2 border-gray-100">
<div class="grid grid-cols-3 gap-6">
<div class="border border-gray-300 rounded-sm p-4 h-32 relative">
<span class="text-xs text-gray-500 uppercase font-bold absolute top-2 left-2">Prepared By</span>
<div class="absolute bottom-10 left-2 font-script text-2xl text-blue-800 opacity-80 rotate-[-2deg]">John Smith</div>
<div class="absolute bottom-2 left-2 text-xs text-gray-900 font-medium">John Smith, Senior Underwriter</div>
<div class="absolute bottom-2 right-2 text-xs text-gray-400">10/24/2023</div>
</div>
<div class="border border-gray-300 rounded-sm p-4 h-32 relative">
<span class="text-xs text-gray-500 uppercase font-bold absolute top-2 left-2">Reviewed By</span>
<div class="absolute bottom-2 left-2 text-xs text-gray-900 border-t border-gray-300 pt-1 w-full mt-8">Sarah Conner, Credit Officer</div>
</div>
<div class="border border-gray-300 rounded-sm p-4 h-32 relative bg-gray-50">
<span class="text-xs text-gray-500 uppercase font-bold absolute top-2 left-2">Approved By</span>
<div class="absolute bottom-2 left-2 text-xs text-gray-900 border-t border-gray-300 pt-1 w-full mt-8">Credit Committee Chair</div>
</div>
</div>
</section>
<!-- Footer -->
<footer class="mt-12 pt-4 border-t border-gray-200 flex justify-between text-[10px] text-gray-400 font-mono uppercase">
<div>
<span>Buddy – The Underwriter</span>
<span class="mx-2">|</span>
<span class="text-red-400 font-bold">Confidential</span>
</div>
<div>
<span>Deal ID: 8492</span>
<span class="mx-2">|</span>
<span>Page 1 of 1</span>
</div>
</footer>
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
