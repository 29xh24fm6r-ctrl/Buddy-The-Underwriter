import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Borrower Portal — Document Upload &amp; Review";
const FONT_LINKS = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "background-light": "#f6f7f8",
                        "background-dark": "#101822",
                        "surface-light": "#ffffff",
                        "surface-dark": "#1a2430",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "body": ["Inter", "sans-serif"],
                    },
                    borderRadius: {
                        "DEFAULT": "0.25rem",
                        "lg": "0.5rem",
                        "xl": "0.75rem",
                        "full": "9999px"
                    },
                },
            },
        }`;
const STYLES = [
  "body {\n            font-family: 'Inter', sans-serif;\n        }\n        /* Custom scrollbar for cleaner look */\n        .custom-scrollbar::-webkit-scrollbar {\n            width: 6px;\n            height: 6px;\n        }\n        .custom-scrollbar::-webkit-scrollbar-track {\n            background: transparent;\n        }\n        .custom-scrollbar::-webkit-scrollbar-thumb {\n            background-color: #d1d5db;\n            border-radius: 20px;\n        }"
];
const BODY_HTML = `<!-- Top Navigation -->
<header class="flex-shrink-0 bg-white border-b border-[#f0f2f4] h-16 px-6 flex items-center justify-between z-20">
<div class="flex items-center gap-4">
<div class="size-8 flex items-center justify-center bg-primary/10 rounded-lg text-primary">
<span class="material-symbols-outlined">description</span>
</div>
<div>
<h1 class="text-lg font-bold leading-tight tracking-tight text-[#111418]">Buddy Portal</h1>
<p class="text-xs text-gray-500 font-medium">1234 Market Street Refinance</p>
</div>
</div>
<div class="flex items-center gap-6">
<button class="text-sm font-semibold text-gray-500 hover:text-primary transition-colors">Save &amp; Exit</button>
<div class="flex items-center gap-3 pl-6 border-l border-gray-100">
<div class="text-right hidden sm:block">
<p class="text-sm font-bold text-[#111418]">Alex Mercer</p>
<p class="text-xs text-gray-500">Highland Capital</p>
</div>
<div class="bg-gray-200 bg-center bg-no-repeat bg-cover rounded-full size-10 border-2 border-white shadow-sm" data-alt="Portrait of a user" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuDzQt9_v636iW7YPvLnFzupDGo2iVU-vf8kq2FQ_GNwEjO3IDOBJjtLFKWK3bhGz_eIXshelNa_VFXaR6QwEhXl3rVGgeJWqV1crPceAVXLDlONbMhS7pR1hevwy2YrE5OOaJE23ShvfqAGPZCRX_XjfSjx4kO_PngnwiB9tfTbHqqXSLI_YEwXBt6Op3FdI8PdYKztOZC4vE5DuoFJ3CCrKhovnrxofJvoKnJijQgYrMUBAqKg75BAHu3-4JZX1oT4pBYzvkaBn-E");'>
</div>
</div>
</div>
</header>
<!-- Main Content Area (3 Columns) -->
<main class="flex-1 flex overflow-hidden">
<!-- LEFT COLUMN: Document Navigator -->
<aside class="w-[320px] flex-shrink-0 bg-white border-r border-[#f0f2f4] flex flex-col z-10">
<div class="p-5 border-b border-[#f0f2f4]">
<h2 class="text-[#111418] text-lg font-bold mb-4">Your Documents</h2>
<!-- Upload Area -->
<div class="border-2 border-dashed border-gray-200 rounded-xl bg-gray-50 p-4 flex flex-col items-center justify-center text-center gap-2 hover:border-primary/50 transition-colors cursor-pointer group">
<div class="size-10 bg-white rounded-full flex items-center justify-center shadow-sm text-primary group-hover:scale-110 transition-transform">
<span class="material-symbols-outlined">cloud_upload</span>
</div>
<div>
<p class="text-sm font-bold text-gray-900">Upload New Document</p>
<p class="text-xs text-gray-500 mt-1">PDF, Excel, Word (Max 50MB)</p>
</div>
</div>
</div>
<!-- Document List -->
<div class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
<!-- Active Item -->
<div class="flex flex-col gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 cursor-pointer shadow-sm">
<div class="flex items-start justify-between">
<div class="flex items-center gap-3 overflow-hidden">
<div class="flex items-center justify-center rounded-lg bg-white shrink-0 size-10 text-primary border border-primary/10">
<span class="material-symbols-outlined">table_chart</span>
</div>
<div class="flex flex-col min-w-0">
<p class="text-[#111418] text-sm font-bold truncate">2023 T-12 Statement</p>
<p class="text-gray-500 text-xs truncate">Oct 24, 2023 • XLSX</p>
</div>
</div>
</div>
<div class="flex items-center justify-between mt-1 pl-[52px]">
<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100">
<span class="size-1.5 rounded-full bg-amber-500"></span>
                            Needs Input
                        </span>
<span class="material-symbols-outlined text-primary text-[18px]">arrow_forward_ios</span>
</div>
</div>
<!-- Completed Item -->
<div class="flex flex-col gap-2 p-3 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100 cursor-pointer transition-colors">
<div class="flex items-start justify-between">
<div class="flex items-center gap-3 overflow-hidden">
<div class="flex items-center justify-center rounded-lg bg-[#f0f2f4] shrink-0 size-10 text-gray-600">
<span class="material-symbols-outlined">picture_as_pdf</span>
</div>
<div class="flex flex-col min-w-0">
<p class="text-[#111418] text-sm font-medium truncate">Rent Roll - Q3 2023</p>
<p class="text-gray-500 text-xs truncate">Oct 24, 2023 • PDF</p>
</div>
</div>
</div>
<div class="flex items-center justify-between mt-1 pl-[52px]">
<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-100">
<span class="material-symbols-outlined text-[12px]">check</span>
                            Confirmed
                        </span>
</div>
</div>
<!-- Processing Item -->
<div class="flex flex-col gap-2 p-3 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100 cursor-pointer transition-colors">
<div class="flex items-start justify-between">
<div class="flex items-center gap-3 overflow-hidden">
<div class="flex items-center justify-center rounded-lg bg-[#f0f2f4] shrink-0 size-10 text-gray-600">
<span class="material-symbols-outlined">description</span>
</div>
<div class="flex flex-col min-w-0">
<p class="text-[#111418] text-sm font-medium truncate">Appraisal Report</p>
<p class="text-gray-500 text-xs truncate">Just now • PDF</p>
</div>
</div>
</div>
<div class="flex items-center justify-between mt-1 pl-[52px]">
<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
<span class="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                            Processing...
                        </span>
</div>
</div>
<!-- Pending Review -->
<div class="flex flex-col gap-2 p-3 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100 cursor-pointer transition-colors">
<div class="flex items-start justify-between">
<div class="flex items-center gap-3 overflow-hidden">
<div class="flex items-center justify-center rounded-lg bg-[#f0f2f4] shrink-0 size-10 text-gray-600">
<span class="material-symbols-outlined">description</span>
</div>
<div class="flex flex-col min-w-0">
<p class="text-[#111418] text-sm font-medium truncate">Org Chart 2023</p>
<p class="text-gray-500 text-xs truncate">Oct 22, 2023 • PDF</p>
</div>
</div>
</div>
<div class="flex items-center justify-between mt-1 pl-[52px]">
<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">
<span class="size-1.5 rounded-full bg-blue-500"></span>
                            Ready for Review
                        </span>
</div>
</div>
</div>
</aside>
<!-- CENTER COLUMN: Document Preview + Extraction -->
<section class="flex-1 flex flex-col bg-background-light overflow-hidden relative">
<!-- Document Toolbar -->
<div class="h-12 bg-white border-b border-[#f0f2f4] flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
<div class="flex items-center gap-2">
<span class="text-sm font-semibold text-gray-700">2023 T-12 Statement.xlsx</span>
</div>
<div class="flex items-center gap-2 bg-[#f0f2f4] rounded-md p-0.5">
<button class="p-1 hover:bg-white rounded text-gray-600 hover:text-[#111418]"><span class="material-symbols-outlined text-[18px]">remove</span></button>
<span class="text-xs font-medium px-2 text-gray-600">100%</span>
<button class="p-1 hover:bg-white rounded text-gray-600 hover:text-[#111418]"><span class="material-symbols-outlined text-[18px]">add</span></button>
</div>
<div class="flex items-center gap-2">
<span class="text-xs text-gray-500 font-medium">Page 1 of 4</span>
<div class="flex gap-1">
<button class="p-1 hover:bg-[#f0f2f4] rounded text-gray-400"><span class="material-symbols-outlined text-[18px]">chevron_left</span></button>
<button class="p-1 hover:bg-[#f0f2f4] rounded text-gray-600"><span class="material-symbols-outlined text-[18px]">chevron_right</span></button>
</div>
</div>
</div>
<!-- Scrollable Container for Preview + Data -->
<div class="flex-1 overflow-y-auto custom-scrollbar p-6">
<div class="max-w-4xl mx-auto flex flex-col gap-6">
<!-- PDF/Doc Preview Area -->
<div class="w-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden relative group">
<!-- Simulated Spreadsheet Header -->
<div class="h-8 bg-gray-50 border-b border-gray-200 flex items-center px-4 gap-4">
<div class="w-full h-2 bg-gray-200 rounded-full opacity-50"></div>
</div>
<!-- Document Image Representation -->
<div class="relative bg-white p-8 min-h-[400px] flex flex-col gap-4 select-none">
<!-- Abstract Spreadsheet Lines -->
<div class="flex justify-between items-center pb-4 border-b border-gray-100">
<div class="w-1/3 h-6 bg-gray-800 rounded opacity-80"></div>
<div class="w-1/6 h-4 bg-gray-300 rounded"></div>
</div>
<div class="space-y-3">
<!-- Row 1 -->
<div class="flex gap-4">
<div class="w-1/4 h-3 bg-gray-200 rounded"></div>
<div class="flex-1"></div>
<div class="w-1/6 h-3 bg-gray-200 rounded"></div>
<div class="w-1/6 h-3 bg-gray-200 rounded"></div>
</div>
<!-- Row 2 -->
<div class="flex gap-4">
<div class="w-1/3 h-3 bg-gray-200 rounded"></div>
<div class="flex-1"></div>
<div class="w-1/6 h-3 bg-gray-200 rounded"></div>
<div class="w-1/6 h-3 bg-gray-200 rounded"></div>
</div>
<!-- Row 3 (Highlighted) -->
<div class="flex gap-4 relative">
<div class="absolute -inset-2 bg-blue-50/50 border border-blue-200 rounded pointer-events-none"></div>
<div class="w-1/4 h-3 bg-gray-800 rounded"></div>
<div class="flex-1"></div>
<div class="w-1/6 h-3 bg-gray-800 rounded"></div>
<div class="w-1/6 h-3 bg-blue-100 rounded border border-blue-200"></div> <!-- Extracted Value -->
</div>
<!-- Row 4 -->
<div class="flex gap-4">
<div class="w-1/5 h-3 bg-gray-200 rounded"></div>
<div class="flex-1"></div>
<div class="w-1/6 h-3 bg-gray-200 rounded"></div>
<div class="w-1/6 h-3 bg-gray-200 rounded"></div>
</div>
<!-- Row 5 (Highlighted) -->
<div class="flex gap-4 relative mt-4">
<div class="absolute -inset-2 bg-amber-50/50 border border-amber-200 rounded pointer-events-none"></div>
<div class="w-1/3 h-4 bg-gray-800 rounded"></div>
<div class="flex-1"></div>
<div class="w-1/6 h-4 bg-amber-100 rounded border border-amber-200"></div> <!-- Warning Value -->
</div>
</div>
</div>
</div>
<!-- "What We Read" Extraction Summary -->
<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
<div class="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
<h3 class="font-bold text-[#111418] flex items-center gap-2">
<span class="material-symbols-outlined text-primary">auto_awesome</span>
                                What We Read
                            </h3>
<span class="text-xs text-gray-500">Based on Buddy's analysis</span>
</div>
<div class="divide-y divide-gray-100">
<!-- Field 1: OK -->
<div class="grid grid-cols-12 gap-4 px-6 py-4 items-center group hover:bg-gray-50 transition-colors">
<div class="col-span-4">
<label class="text-sm font-medium text-gray-600">Property Name</label>
</div>
<div class="col-span-5">
<div class="text-[#111418] font-semibold">Highland Park Apartments</div>
</div>
<div class="col-span-3 flex justify-end">
<label class="flex items-center gap-2 cursor-pointer select-none">
<input checked="" class="rounded text-green-600 focus:ring-green-500 border-gray-300 size-4" type="checkbox"/>
<span class="text-sm text-gray-600">Looks correct</span>
</label>
</div>
</div>
<!-- Field 2: OK -->
<div class="grid grid-cols-12 gap-4 px-6 py-4 items-center group hover:bg-gray-50 transition-colors">
<div class="col-span-4">
<label class="text-sm font-medium text-gray-600">Reporting Period</label>
</div>
<div class="col-span-5">
<div class="text-[#111418] font-semibold">Jan 1, 2023 — Dec 31, 2023</div>
</div>
<div class="col-span-3 flex justify-end">
<label class="flex items-center gap-2 cursor-pointer select-none">
<input checked="" class="rounded text-green-600 focus:ring-green-500 border-gray-300 size-4" type="checkbox"/>
<span class="text-sm text-gray-600">Looks correct</span>
</label>
</div>
</div>
<!-- Field 3: OK -->
<div class="grid grid-cols-12 gap-4 px-6 py-4 items-center group hover:bg-gray-50 transition-colors">
<div class="col-span-4">
<label class="text-sm font-medium text-gray-600">Gross Potential Rent</label>
</div>
<div class="col-span-5">
<div class="text-[#111418] font-semibold">$4,200,000</div>
</div>
<div class="col-span-3 flex justify-end">
<label class="flex items-center gap-2 cursor-pointer select-none">
<input checked="" class="rounded text-green-600 focus:ring-green-500 border-gray-300 size-4" type="checkbox"/>
<span class="text-sm text-gray-600">Looks correct</span>
</label>
</div>
</div>
<!-- Field 4: Needs Input -->
<div class="grid grid-cols-12 gap-4 px-6 py-4 items-center bg-amber-50/40 relative">
<div class="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>
<div class="col-span-4">
<label class="text-sm font-bold text-gray-800">Net Operating Income</label>
</div>
<div class="col-span-5">
<div class="flex items-center gap-2">
<input class="w-full text-sm rounded border-amber-300 bg-white focus:border-amber-500 focus:ring-amber-500 text-gray-900 font-semibold" placeholder="Enter value" type="text" value="$2,350,00"/>
</div>
<p class="text-xs text-amber-700 mt-1">Please verify this value matches the document.</p>
</div>
<div class="col-span-3 flex justify-end">
<button class="text-sm font-medium text-primary hover:text-primary/80 underline decoration-dotted">Edit value</button>
</div>
</div>
</div>
</div>
<!-- Spacer for scroll -->
<div class="h-10"></div>
</div>
</div>
</section>
<!-- RIGHT COLUMN: Review & Confirm -->
<aside class="w-[360px] flex-shrink-0 bg-white border-l border-[#f0f2f4] flex flex-col z-10 shadow-[0_0_15px_rgba(0,0,0,0.05)]">
<div class="p-6 flex-1 overflow-y-auto custom-scrollbar">
<h2 class="text-[#111418] text-xl font-bold mb-6">Review &amp; Confirm</h2>
<!-- Progress Status -->
<div class="mb-8">
<div class="flex justify-between items-end mb-2">
<span class="text-sm font-medium text-gray-600">Confirmation Progress</span>
<span class="text-sm font-bold text-primary">3 of 5 Docs</span>
</div>
<div class="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
<div class="h-full bg-primary w-3/5 rounded-full"></div>
</div>
<p class="text-xs text-gray-400 mt-2">Finish confirming all documents to submit.</p>
</div>
<!-- Action Needed Card -->
<div class="rounded-xl bg-amber-50 border border-amber-100 p-4 mb-6">
<div class="flex items-start gap-3">
<span class="material-symbols-outlined text-amber-600 mt-0.5">info</span>
<div>
<h3 class="text-sm font-bold text-amber-900">Fields Needing Attention</h3>
<p class="text-sm text-amber-800 mt-1 leading-relaxed">
                                We couldn't confidently read the <span class="font-bold">Net Operating Income</span>. Please confirm the value in the center panel.
                            </p>
<button class="mt-3 text-xs font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1">
                                Go to field <span class="material-symbols-outlined text-[14px]">arrow_downward</span>
</button>
</div>
</div>
</div>
<!-- Friendly Guidance -->
<div class="mb-8 text-sm text-gray-600 space-y-3">
<p>Please review the highlighted fields in the center panel. You can edit anything that doesn't look right.</p>
<p>Once you are comfortable with the extracted data, click confirm below.</p>
</div>
<!-- Main Actions -->
<div class="space-y-3">
<button class="w-full flex items-center justify-center gap-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg shadow-sm transition-all transform active:scale-[0.98]">
<span class="material-symbols-outlined">check_circle</span>
                        Confirm &amp; Submit Document
                    </button>
<div class="grid grid-cols-2 gap-3">
<button class="w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm">
                            Save for later
                        </button>
<button class="w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm">
                            Upload new version
                        </button>
</div>
</div>
</div>
<!-- Footer Helper -->
<div class="bg-gray-50 p-5 border-t border-gray-100">
<p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Your Relationship Manager</p>
<div class="flex items-center gap-3">
<div class="size-10 rounded-full bg-gray-200 bg-cover bg-center" data-alt="Photo of Sarah Jenkins" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuBmCn0NLf8sFK700M_xEHJEkOQ_LW5kHTxrhPhtRGH6ODQb3xBmkIX83V9SFJWPAGgYwWqzBOPFm_Po-FOFu2GVP0RW9fhlLZheHIeHIRE_1mt4U_8So0r716G04SpTfrrWDoaQD9BtHlSTinpYbGrejF_7cRVQDRr1qNQ5zdmOXvzmE6Gd8mSf_krpG1sOLzbJ4V4iTY0pjogit7wyLXLHCFWGBVo1SHLuNrjE4xtu1HXrrdaxgF07ciBimcZ4BD_lMieUu-G1mDc");'>
</div>
<div>
<p class="text-sm font-bold text-gray-900">Sarah Jenkins</p>
<div class="flex items-center gap-2 text-xs text-gray-500">
<span class="hover:underline cursor-pointer">s.jenkins@buddy.com</span>
<span>•</span>
<span>(555) 123-4567</span>
</div>
</div>
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
