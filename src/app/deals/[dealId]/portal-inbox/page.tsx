import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Buddy Portal - Borrower Task Inbox";
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
                        "display": ["Inter", "sans-serif"],
                        "sans": ["Inter", "sans-serif"],
                    },
                    borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
                },
            },
        }`;
const STYLES = [
  "body { font-family: 'Inter', sans-serif; }\n        .scrollbar-hide::-webkit-scrollbar {\n            display: none;\n        }\n        .scrollbar-hide {\n            -ms-overflow-style: none;\n            scrollbar-width: none;\n        }"
];
const BODY_HTML = `<!-- Sticky Header -->
<header class="sticky top-0 z-50 flex items-center justify-between border-b border-[#f0f2f4] bg-white/95 backdrop-blur-sm px-6 py-3 shadow-sm h-16">
<!-- Left: Logo & Deal -->
<div class="flex items-center gap-4 w-1/4">
<div class="flex items-center gap-2">
<div class="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
<svg fill="none" height="20" viewbox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg">
<path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
<path d="M2 17L12 22L22 17" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
<path d="M2 12L12 17L22 12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
</svg>
</div>
<div>
<h2 class="text-sm font-bold leading-tight text-slate-900">Buddy Portal</h2>
<p class="text-xs text-slate-500 font-medium truncate">1234 Market Street Refinance</p>
</div>
</div>
</div>
<!-- Center: Breadcrumbs -->
<div class="flex-1 flex justify-center w-2/4">
<div class="flex items-center gap-2 px-4 py-1 rounded-full bg-slate-50 border border-slate-100">
<a class="text-slate-500 text-sm font-medium hover:text-primary transition-colors" href="#">Home</a>
<span class="text-slate-300 text-sm font-medium">/</span>
<span class="text-slate-900 text-sm font-semibold">Document Requests</span>
</div>
</div>
<!-- Right: Actions & User -->
<div class="flex items-center justify-end gap-4 w-1/4">
<button class="hidden md:flex items-center justify-center px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm">
                Save &amp; Exit
            </button>
<div class="h-8 w-[1px] bg-slate-200 mx-1"></div>
<div class="flex items-center gap-3">
<div class="flex flex-col items-end hidden lg:flex">
<span class="text-sm font-semibold text-slate-900">Alex Mercer</span>
<span class="text-xs text-slate-500">Sponsor</span>
</div>
<div class="size-9 rounded-full bg-cover bg-center ring-2 ring-white shadow-sm" data-alt="Portrait of Alex Mercer" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuCBSlbWA_QiUjId-R4JCcWjsJ92SYyhpxj_ht8kv9NBlV8spQ-FIolpIYD7zChPgE4T1rjz6Ta6C5jsNvzXCLemcUh_LujP9vFoKORnjLRHN834eFxKcsfMAdgKRrAUl6GlMG_mY9ar_O3cyRwyFnqzICyPpmFBeh2AsXD-O-s6mLm8feurLGrmLItv1Ln05BLgGB1PGGNW-lJ_I0wJjzfz-GG91nKs9KjjYfLG7wv-uBzUU69WBjN-k0yafD37Di6ryD8RVdRWbfA');"></div>
<button class="size-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors">
<span class="material-symbols-outlined text-[20px]">help</span>
</button>
</div>
</div>
</header>
<!-- Main Content Grid -->
<main class="flex-1 overflow-hidden">
<div class="h-full w-full max-w-[1600px] mx-auto grid grid-cols-12">
<!-- LEFT COLUMN: Navigator -->
<aside class="col-span-3 h-full border-r border-[#f0f2f4] bg-white overflow-y-auto scrollbar-hide flex flex-col">
<!-- Progress Card -->
<div class="p-5 border-b border-[#f0f2f4]">
<div class="rounded-xl border border-slate-100 bg-slate-50/50 p-4 shadow-sm">
<div class="flex justify-between items-end mb-2">
<h3 class="text-sm font-semibold text-slate-900">Overall Progress</h3>
<span class="text-xs font-bold text-primary">75%</span>
</div>
<div class="h-2 w-full bg-slate-200 rounded-full mb-3">
<div class="h-full bg-primary rounded-full" style="width: 75%"></div>
</div>
<p class="text-sm font-bold text-slate-900">9 of 12 complete</p>
<p class="text-xs text-amber-600 font-medium mt-1 flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]">timer</span>
                            Next deadline: 2 days
                        </p>
</div>
</div>
<!-- Filters -->
<div class="px-5 pt-4 pb-2">
<h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Filter Requests</h4>
<div class="flex flex-wrap gap-2">
<button class="px-3 py-1.5 rounded-full bg-primary text-white text-xs font-medium shadow-sm ring-1 ring-primary/10">All</button>
<button class="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors">Due Soon</button>
<button class="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors">Missing</button>
<button class="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors">Needs Review</button>
</div>
</div>
<!-- Navigation List -->
<div class="flex-1 px-3 py-2 space-y-1">
<!-- Active Item -->
<div class="group flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10 cursor-pointer">
<div class="mt-0.5 text-primary">
<span class="material-symbols-outlined text-[20px]">description</span>
</div>
<div class="flex-1 min-w-0">
<p class="text-sm font-semibold text-slate-900 truncate">Rent Roll (Current)</p>
<p class="text-xs text-slate-500 mt-0.5">Updated 2m ago</p>
</div>
<div class="flex flex-col items-end gap-1">
<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100">Due Soon</span>
</div>
</div>
<!-- Item 2 -->
<div class="group flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-100 transition-colors">
<div class="mt-0.5 text-slate-400 group-hover:text-slate-600">
<span class="material-symbols-outlined text-[20px]">table_chart</span>
</div>
<div class="flex-1 min-w-0">
<p class="text-sm font-medium text-slate-700 group-hover:text-slate-900 truncate">Operating Stmt (T-12)</p>
<p class="text-xs text-slate-400 mt-0.5">Due Oct 12</p>
</div>
<div class="flex flex-col items-end gap-1">
<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-100">Missing</span>
</div>
</div>
<!-- Item 3 -->
<div class="group flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-100 transition-colors">
<div class="mt-0.5 text-slate-400 group-hover:text-slate-600">
<span class="material-symbols-outlined text-[20px]">badge</span>
</div>
<div class="flex-1 min-w-0">
<p class="text-sm font-medium text-slate-700 group-hover:text-slate-900 truncate">Sponsor Org Chart</p>
<p class="text-xs text-slate-400 mt-0.5">Due Oct 20</p>
</div>
<div class="flex flex-col items-end gap-1">
<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">Review</span>
</div>
</div>
<!-- Item 4 -->
<div class="group flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-100 transition-colors">
<div class="mt-0.5 text-green-600">
<span class="material-symbols-outlined text-[20px]">check_circle</span>
</div>
<div class="flex-1 min-w-0">
<p class="text-sm font-medium text-slate-700 group-hover:text-slate-900 truncate">Articles of Incorp.</p>
<p class="text-xs text-slate-400 mt-0.5">Submitted yesterday</p>
</div>
<div class="flex flex-col items-end gap-1">
<span class="text-[10px] font-medium text-green-600">Submitted</span>
</div>
</div>
</div>
</aside>
<!-- CENTER COLUMN: Main Workspace -->
<section class="col-span-6 h-full bg-[#F9FAFB] overflow-y-auto p-6 md:p-8">
<div class="max-w-4xl mx-auto flex flex-col gap-6">
<!-- Workspace Header -->
<div class="flex justify-between items-start">
<div>
<h1 class="text-2xl font-bold text-slate-900 tracking-tight">Document Requests</h1>
<p class="text-sm text-slate-600 mt-1 max-w-lg leading-relaxed">
                                Upload the requested documents below. We’ll automatically read key fields and flag anything that needs confirmation.
                            </p>
</div>
<div class="flex gap-3">
<button class="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-100 transition-colors">
<span class="material-symbols-outlined text-[18px]">download</span>
                                Checklist (PDF)
                            </button>
<button class="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-100 transition-colors">
<span class="material-symbols-outlined text-[18px]">info</span>
                                How it works
                            </button>
</div>
</div>
<!-- Bulk Upload Area -->
<div class="relative group rounded-xl border-2 border-dashed border-primary/30 bg-white p-8 flex flex-col items-center justify-center text-center hover:border-primary hover:bg-primary/5 transition-all duration-300 shadow-sm">
<div class="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
<span class="material-symbols-outlined text-[28px]">cloud_upload</span>
</div>
<h3 class="text-lg font-semibold text-slate-900 mb-1">Drag &amp; drop your files here</h3>
<p class="text-sm text-slate-500 mb-6">Upload multiple files at once (PDF, XLSX, DOCX). Max 50MB each.</p>
<button class="flex items-center justify-center px-6 py-2.5 rounded-lg bg-primary text-white text-sm font-bold shadow-md hover:bg-blue-600 hover:shadow-lg transition-all active:scale-95">
                            Browse Files
                        </button>
</div>
<!-- Requests Table -->
<div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
<table class="w-full text-left border-collapse">
<thead>
<tr class="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 font-semibold">
<th class="px-6 py-4">Document</th>
<th class="px-6 py-4 w-32">Due</th>
<th class="px-6 py-4 w-32">Status</th>
<th class="px-6 py-4 w-24 text-right">Action</th>
</tr>
</thead>
<tbody class="divide-y divide-slate-100">
<!-- Row 1: Active/Selected -->
<tr class="bg-primary/5 hover:bg-primary/10 cursor-pointer transition-colors relative">
<td class="px-6 py-4">
<div class="flex items-center gap-3">
<div class="bg-white rounded border border-slate-200 p-1.5 text-slate-400">
<span class="material-symbols-outlined text-[20px]">description</span>
</div>
<div>
<p class="text-sm font-semibold text-slate-900">Rent Roll (Current)</p>
<p class="text-xs text-slate-500">Property Financials</p>
</div>
</div>
<div class="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>
</td>
<td class="px-6 py-4">
<div class="flex items-center gap-1.5 text-amber-600">
<span class="material-symbols-outlined text-[16px]">calendar_clock</span>
<span class="text-sm font-medium">Oct 12</span>
</div>
</td>
<td class="px-6 py-4">
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                            Due Soon
                                        </span>
</td>
<td class="px-6 py-4 text-right">
<button class="text-primary text-sm font-bold hover:underline">Upload</button>
</td>
</tr>
<!-- Row 2: Missing -->
<tr class="hover:bg-slate-50 cursor-pointer transition-colors">
<td class="px-6 py-4">
<div class="flex items-center gap-3">
<div class="bg-slate-50 rounded border border-slate-200 p-1.5 text-slate-400">
<span class="material-symbols-outlined text-[20px]">table_chart</span>
</div>
<div>
<p class="text-sm font-medium text-slate-900">Operating Statement (T-12)</p>
<p class="text-xs text-slate-500">Property Financials</p>
</div>
</div>
</td>
<td class="px-6 py-4">
<div class="flex items-center gap-1.5 text-red-600">
<span class="material-symbols-outlined text-[16px]">error</span>
<span class="text-sm font-medium">Oct 12</span>
</div>
</td>
<td class="px-6 py-4">
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-white text-red-600 border border-red-200">
                                            Missing
                                        </span>
</td>
<td class="px-6 py-4 text-right">
<button class="text-primary text-sm font-bold hover:underline">Upload</button>
</td>
</tr>
<!-- Row 3: Needs Review -->
<tr class="hover:bg-slate-50 cursor-pointer transition-colors">
<td class="px-6 py-4">
<div class="flex items-center gap-3">
<div class="bg-slate-50 rounded border border-slate-200 p-1.5 text-slate-400">
<span class="material-symbols-outlined text-[20px]">badge</span>
</div>
<div>
<p class="text-sm font-medium text-slate-900">Sponsor Org Chart</p>
<p class="text-xs text-slate-500">Legal &amp; Entity</p>
</div>
</div>
</td>
<td class="px-6 py-4">
<span class="text-sm text-slate-500">Oct 20</span>
</td>
<td class="px-6 py-4">
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                            Needs Review
                                        </span>
</td>
<td class="px-6 py-4 text-right">
<button class="text-primary text-sm font-bold hover:underline">Open</button>
</td>
</tr>
<!-- Row 4: Submitted -->
<tr class="hover:bg-slate-50 cursor-pointer transition-colors">
<td class="px-6 py-4">
<div class="flex items-center gap-3">
<div class="bg-green-50 rounded border border-green-200 p-1.5 text-green-600">
<span class="material-symbols-outlined text-[20px]">check</span>
</div>
<div>
<p class="text-sm font-medium text-slate-900">Articles of Incorporation</p>
<p class="text-xs text-slate-500">Legal &amp; Entity</p>
</div>
</div>
</td>
<td class="px-6 py-4">
<span class="text-sm text-slate-400">Done</span>
</td>
<td class="px-6 py-4">
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-50 text-green-700 border border-green-200">
                                            Submitted
                                        </span>
</td>
<td class="px-6 py-4 text-right">
<button class="text-slate-400 text-sm font-medium hover:text-slate-600">View</button>
</td>
</tr>
<!-- Row 5: Submitted -->
<tr class="hover:bg-slate-50 cursor-pointer transition-colors">
<td class="px-6 py-4">
<div class="flex items-center gap-3">
<div class="bg-green-50 rounded border border-green-200 p-1.5 text-green-600">
<span class="material-symbols-outlined text-[20px]">check</span>
</div>
<div>
<p class="text-sm font-medium text-slate-900">Environmental Report Phase I</p>
<p class="text-xs text-slate-500">Property</p>
</div>
</div>
</td>
<td class="px-6 py-4">
<span class="text-sm text-slate-400">Done</span>
</td>
<td class="px-6 py-4">
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-50 text-green-700 border border-green-200">
                                            Submitted
                                        </span>
</td>
<td class="px-6 py-4 text-right">
<button class="text-slate-400 text-sm font-medium hover:text-slate-600">View</button>
</td>
</tr>
</tbody>
</table>
</div>
</div>
</section>
<!-- RIGHT COLUMN: Details & Context -->
<aside class="col-span-3 h-full border-l border-[#f0f2f4] bg-white overflow-y-auto scrollbar-hide flex flex-col">
<!-- Selected Item Details -->
<div class="p-6 border-b border-[#f0f2f4]">
<div class="flex items-start justify-between mb-4">
<div class="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
<span class="material-symbols-outlined text-[24px]">description</span>
</div>
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            Due Soon
                        </span>
</div>
<h2 class="text-lg font-bold text-slate-900 mb-1">Rent Roll (Current)</h2>
<p class="text-sm text-slate-500 mb-6">Due Oct 12, 2023</p>
<!-- Requirements -->
<div class="bg-slate-50 rounded-lg p-4 mb-6">
<h4 class="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Requirements</h4>
<ul class="space-y-2">
<li class="flex items-start gap-2 text-sm text-slate-600">
<span class="material-symbols-outlined text-[16px] text-green-600 mt-0.5">check</span>
<span>Excel (.xlsx) or PDF format</span>
</li>
<li class="flex items-start gap-2 text-sm text-slate-600">
<span class="material-symbols-outlined text-[16px] text-green-600 mt-0.5">check</span>
<span>Must include tenant names, lease start/end dates</span>
</li>
<li class="flex items-start gap-2 text-sm text-slate-600">
<span class="material-symbols-outlined text-[16px] text-green-600 mt-0.5">check</span>
<span>Dated within last 30 days</span>
</li>
</ul>
</div>
<!-- Review Callout (Conditional) -->
<div class="hidden rounded-lg border border-blue-100 bg-blue-50 p-4 mb-6">
<div class="flex items-start gap-3">
<span class="material-symbols-outlined text-blue-600">info</span>
<div>
<p class="text-sm font-semibold text-blue-900">Confirmation Needed</p>
<p class="text-xs text-blue-700 mt-1 mb-3">We found 2 fields needing confirmation (e.g., Net Operating Income).</p>
<button class="text-xs font-bold text-white bg-blue-600 px-3 py-1.5 rounded hover:bg-blue-700">Open Review</button>
</div>
</div>
</div>
</div>
<!-- Messaging -->
<div class="p-6 border-b border-[#f0f2f4]">
<h4 class="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
<span class="material-symbols-outlined text-slate-400">lock</span>
                        Secure Messages
                    </h4>
<div class="flex items-center gap-3 mb-4">
<div class="size-10 rounded-full bg-cover bg-center" data-alt="Relationship Manager Sarah Jenkins" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuCFNFcPoql3HghQecKt95OwlhLf02dE6g3S7vgnjkjRviV_FtUJBEMO74dTgmzilQS_rorgzGoDaRigyTWO4cntHVsfpsVCFSHSbGSeEiQ2SgC2QUYMxsUjvGcG2lhehZG3lU55GyECWZy4UUgcicrG4I_3KCBX6N2q1fApMsb1SFC0Is5IGvEsRK4-jR4Oa5iwyj1w_38FnyjcFZUw1kVGv3wnZv4hr2kBFFeawpb2mi6DLSfDN0HU3dtzQ-64-VnUH0A2R17pB_E');">
<span class="absolute bottom-0 right-0 size-2.5 rounded-full bg-green-500 border-2 border-white translate-x-1 translate-y-1"></span>
</div>
<div>
<p class="text-sm font-semibold text-slate-900">Sarah Jenkins</p>
<p class="text-xs text-slate-500">Relationship Manager</p>
</div>
</div>
<div class="bg-slate-50 rounded-lg p-3 mb-3 border border-slate-100">
<p class="text-xs text-slate-600 leading-relaxed">
                            "Hi Alex, just need clarification on the T-12 Expenses for May. Could you check the maintenance line item?"
                        </p>
<p class="text-[10px] text-slate-400 mt-2 text-right">Today, 9:41 AM</p>
</div>
<button class="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors">
<span class="material-symbols-outlined text-[18px]">send</span>
                        Send Message
                    </button>
</div>
<!-- Audit Trail (Collapsed/Simple) -->
<div class="p-6 flex-1">
<button class="flex items-center justify-between w-full text-left group">
<h4 class="text-sm font-bold text-slate-900">Activity History</h4>
<span class="material-symbols-outlined text-slate-400 group-hover:text-slate-600 transition-transform text-[20px]">expand_more</span>
</button>
<div class="mt-4 space-y-4 pl-2 border-l border-slate-100 ml-1.5">
<div class="relative">
<div class="absolute -left-[13px] top-1 size-2 rounded-full bg-slate-200 ring-4 ring-white"></div>
<p class="text-xs text-slate-600"><span class="font-semibold text-slate-900">You</span> uploaded "Appraisal Report"</p>
<p class="text-[10px] text-slate-400 mt-0.5">Oct 8, 2:11 PM</p>
</div>
<div class="relative">
<div class="absolute -left-[13px] top-1 size-2 rounded-full bg-slate-200 ring-4 ring-white"></div>
<p class="text-xs text-slate-600"><span class="font-semibold text-slate-900">System</span> flagged "T-12" for review</p>
<p class="text-[10px] text-slate-400 mt-0.5">Oct 7, 4:30 PM</p>
</div>
<div class="relative">
<div class="absolute -left-[13px] top-1 size-2 rounded-full bg-slate-200 ring-4 ring-white"></div>
<p class="text-xs text-slate-600"><span class="font-semibold text-slate-900">Sarah</span> requested 2 new docs</p>
<p class="text-[10px] text-slate-400 mt-0.5">Oct 5, 10:00 AM</p>
</div>
</div>
</div>
</aside>
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
