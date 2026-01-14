import { redirect } from "next/navigation";

const TITLE = "Underwriting Results Display - Buddy The Underwriter";
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
              "neutral-border": "#dbe0e6",
            },
            fontFamily: {
              "display": ["Inter", "sans-serif"],
              "body": ["Inter", "sans-serif"],
            },
            borderRadius: {
              "DEFAULT": "0.25rem",
              "md": "0.375rem",
              "lg": "0.5rem", 
              "xl": "0.75rem",
              "full": "9999px"
            },
          },
        },
      }`;
const STYLES = [
  "body {\n            font-family: 'Inter', sans-serif;\n        }\n        .material-symbols-outlined {\n            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;\n        }"
];
const BODY_HTML = `<!-- Top Navigation -->
<header class="flex items-center justify-between whitespace-nowrap border-b border-solid border-neutral-border bg-white dark:bg-[#111418] px-10 py-3 sticky top-0 z-50">
<div class="flex items-center gap-4 text-[#111418] dark:text-white">
<div class="size-6 text-primary">
<svg fill="currentColor" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<path d="M8.57829 8.57829C5.52816 11.6284 3.451 15.5145 2.60947 19.7452C1.76794 23.9758 2.19984 28.361 3.85056 32.3462C5.50128 36.3314 8.29667 39.7376 11.8832 42.134C15.4698 44.5305 19.6865 45.8096 24 45.8096C28.3135 45.8096 32.5302 44.5305 36.1168 42.134C39.7033 39.7375 42.4987 36.3314 44.1494 32.3462C45.8002 28.361 46.2321 23.9758 45.3905 19.7452C44.549 15.5145 42.4718 11.6284 39.4217 8.57829L24 24L8.57829 8.57829Z"></path>
</svg>
</div>
<h2 class="text-[#111418] dark:text-white text-lg font-bold leading-tight tracking-tight">Buddy The Underwriter</h2>
</div>
<div class="flex flex-1 justify-end gap-6 items-center">
<button class="flex items-center justify-center text-[#617289] hover:text-primary transition-colors">
<span class="material-symbols-outlined">help</span>
</button>
<button class="flex items-center justify-center text-[#617289] hover:text-primary transition-colors">
<span class="material-symbols-outlined">notifications</span>
</button>
<div class="h-8 w-px bg-neutral-border"></div>
<div class="flex items-center gap-3">
<div class="text-right hidden sm:block">
<p class="text-sm font-semibold text-[#111418] dark:text-white">Alex Morgan</p>
<p class="text-xs text-[#617289]">Senior Underwriter</p>
</div>
<div class="bg-center bg-no-repeat bg-cover rounded-full size-10 border border-neutral-border" data-alt="User avatar showing a professional smiling person" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuDzrVqxHWGY3pi4gdbpIUYKxsnqO3f7OqyfsU7fiyZL5hrNvLd6-Vhe8eQqxzIjE45dBvnbXDbVc8NvToXL13g3ygxbNxz3pUf2VAFQ5rKwWDTKzJXzUuB_WxP6oONoXvpOfGVoiBPe7fY4_uowMQ9YSBQn2vo3WzbUwpUaP89Glyjfyi9mu5wSKW8t64CNgUPhV9GGTxLghmuKdLF2PFSrQw8rKNNQVbLKAoJy6nNxAU0uwaUPJMTw4hfvSDTQGqpEldqdqSP6258");'></div>
</div>
</div>
</header>
<main class="flex-1 flex flex-col items-center py-8 px-6 sm:px-10 lg:px-20 bg-background-light dark:bg-background-dark w-full overflow-x-hidden">
<div class="w-full max-w-7xl flex flex-col gap-6">
<!-- Breadcrumbs -->
<div class="flex flex-wrap gap-2 items-center text-sm">
<a class="text-[#617289] font-medium hover:text-primary transition-colors" href="#">Projects</a>
<span class="text-[#617289] material-symbols-outlined text-sm">chevron_right</span>
<a class="text-[#617289] font-medium hover:text-primary transition-colors" href="#">Workflow #123</a>
<span class="text-[#617289] material-symbols-outlined text-sm">chevron_right</span>
<span class="text-[#111418] dark:text-white font-semibold">Results</span>
</div>
<!-- Page Header -->
<div class="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2 border-b border-neutral-border/50">
<div class="flex flex-col gap-2">
<h1 class="text-[#111418] dark:text-white text-3xl font-black leading-tight tracking-[-0.02em]">Merchant Cash Advance App</h1>
<p class="text-[#617289] text-base font-normal">Review the generated interface logic and layout based on your prompt.</p>
</div>
<div class="flex items-center gap-3">
<div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-bold">
<span class="material-symbols-outlined text-lg">check_circle</span>
                        Generation Complete
                    </div>
</div>
</div>
<!-- Main Content Grid -->
<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-4">
<!-- Left Column: The Canvas (Result) -->
<div class="lg:col-span-8 xl:col-span-9 flex flex-col gap-6">
<!-- Toolbar for Canvas -->
<div class="flex items-center justify-between">
<div class="flex gap-2">
<button class="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-[#1e293b] border border-neutral-border text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#2a3649] transition-colors shadow-sm text-[#111418] dark:text-white">
<span class="material-symbols-outlined text-lg">desktop_windows</span>
                                Desktop
                            </button>
<button class="flex items-center gap-2 px-3 py-2 rounded-lg bg-transparent text-[#617289] text-sm font-medium hover:text-[#111418] dark:hover:text-white transition-colors">
<span class="material-symbols-outlined text-lg">smartphone</span>
                                Mobile
                            </button>
</div>
<div class="flex gap-2">
<button class="flex items-center gap-2 px-3 py-2 rounded-lg bg-transparent text-[#617289] text-sm font-medium hover:text-[#111418] dark:hover:text-white transition-colors">
<span class="material-symbols-outlined text-lg">restart_alt</span>
                                Regenerate
                            </button>
</div>
</div>
<!-- The Generated UI Canvas -->
<div class="w-full bg-white dark:bg-[#1e293b] rounded-xl border border-neutral-border shadow-sm overflow-hidden flex flex-col min-h-[600px] relative group/canvas">
<!-- Mock Browser Chrome -->
<div class="h-10 bg-[#f0f2f4] dark:bg-[#0f172a] border-b border-neutral-border flex items-center px-4 gap-2">
<div class="flex gap-1.5">
<div class="size-3 rounded-full bg-[#ff5f56]"></div>
<div class="size-3 rounded-full bg-[#ffbd2e]"></div>
<div class="size-3 rounded-full bg-[#27c93f]"></div>
</div>
<div class="flex-1 mx-4">
<div class="h-6 w-full max-w-md mx-auto bg-white dark:bg-[#1e293b] rounded text-xs flex items-center justify-center text-[#617289] px-2 truncate">
                                    https://internal.buddy.ai/preview/mca-workflow-v1
                                </div>
</div>
</div>
<!-- Actual Generated Content (Mock) -->
<div class="flex-1 p-8 overflow-y-auto bg-[#FAFBFC] dark:bg-[#111418] relative">
<!-- This is a representation of the 'generated result' -->
<div class="max-w-2xl mx-auto bg-white dark:bg-[#1e293b] p-8 rounded-lg shadow-sm border border-neutral-border/60">
<div class="flex justify-between items-start mb-8 border-b border-gray-100 dark:border-gray-700 pb-4">
<div>
<h3 class="text-xl font-bold text-gray-900 dark:text-white mb-1">New Application</h3>
<p class="text-sm text-gray-500">ID: MCA-2023-8892</p>
</div>
<span class="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-semibold uppercase">Draft</span>
</div>
<div class="space-y-6">
<div class="grid grid-cols-2 gap-4">
<div class="space-y-1">
<label class="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Business Legal Name</label>
<div class="h-10 w-full bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"></div>
</div>
<div class="space-y-1">
<label class="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">DBA (If applicable)</label>
<div class="h-10 w-full bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"></div>
</div>
</div>
<div class="space-y-1">
<label class="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Monthly Gross Revenue</label>
<div class="flex items-center gap-3 p-3 rounded bg-blue-50/50 border border-blue-100 dark:bg-blue-900/10 dark:border-blue-800">
<span class="material-symbols-outlined text-blue-600">attach_money</span>
<div class="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
</div>
</div>
<div class="grid grid-cols-3 gap-4">
<div class="col-span-1 p-4 rounded border border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center gap-2 text-center bg-gray-50 dark:bg-gray-800/50">
<span class="material-symbols-outlined text-gray-400">upload_file</span>
<span class="text-xs text-gray-500">Upload Bank Statements</span>
</div>
<div class="col-span-2 space-y-3">
<div class="flex justify-between items-center">
<span class="text-sm font-medium text-gray-700 dark:text-gray-300">Credit Score Check</span>
<span class="text-sm font-bold text-green-600">720 (Low Risk)</span>
</div>
<div class="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
<div class="bg-green-500 h-2 rounded-full" style="width: 85%"></div>
</div>
</div>
</div>
<div class="pt-6 mt-6 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
<div class="h-9 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
<div class="h-9 w-32 bg-primary/20 rounded"></div>
</div>
</div>
</div>
</div>
</div>
</div>
<!-- Right Column: Stats & Actions -->
<div class="lg:col-span-4 xl:col-span-3 flex flex-col gap-6">
<!-- Stats Card -->
<div class="bg-white dark:bg-[#1e293b] rounded-xl border border-neutral-border p-5 shadow-sm">
<h3 class="text-[#111418] dark:text-white font-bold text-lg mb-4">Build Summary</h3>
<div class="space-y-4">
<div class="flex items-center justify-between pb-3 border-b border-neutral-border/50">
<span class="text-[#617289] text-sm">Estimated Saved Time</span>
<span class="text-[#111418] dark:text-white font-semibold">~12 Hours</span>
</div>
<div class="flex items-center justify-between pb-3 border-b border-neutral-border/50">
<span class="text-[#617289] text-sm">Code Readiness</span>
<div class="flex items-center gap-1 text-green-600 dark:text-green-400 font-semibold text-sm">
<span class="material-symbols-outlined text-sm">check_circle</span> 100%
                                </div>
</div>
<div class="flex items-center justify-between">
<span class="text-[#617289] text-sm">Complexity</span>
<span class="px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 text-xs font-bold">Medium</span>
</div>
</div>
</div>
<!-- Component List (Read Only) -->
<div class="bg-white dark:bg-[#1e293b] rounded-xl border border-neutral-border p-5 shadow-sm flex-1">
<h3 class="text-[#111418] dark:text-white font-bold text-lg mb-4">Generated Components</h3>
<div class="flex flex-col gap-3">
<div class="flex items-start gap-3 p-3 rounded-lg bg-[#f6f7f8] dark:bg-[#111418] border border-neutral-border/50">
<span class="material-symbols-outlined text-primary mt-0.5">input</span>
<div>
<p class="text-sm font-semibold text-[#111418] dark:text-white">Smart Inputs</p>
<p class="text-xs text-[#617289]">Validation included for Tax ID &amp; SSN.</p>
</div>
</div>
<div class="flex items-start gap-3 p-3 rounded-lg bg-[#f6f7f8] dark:bg-[#111418] border border-neutral-border/50">
<span class="material-symbols-outlined text-primary mt-0.5">account_tree</span>
<div>
<p class="text-sm font-semibold text-[#111418] dark:text-white">Logic Tree</p>
<p class="text-xs text-[#617289]">Auto-risk assignment based on credit score.</p>
</div>
</div>
<div class="flex items-start gap-3 p-3 rounded-lg bg-[#f6f7f8] dark:bg-[#111418] border border-neutral-border/50">
<span class="material-symbols-outlined text-primary mt-0.5">upload_file</span>
<div>
<p class="text-sm font-semibold text-[#111418] dark:text-white">File Dropzone</p>
<p class="text-xs text-[#617289]">Multi-file support for PDF statements.</p>
</div>
</div>
</div>
</div>
<!-- Action Buttons -->
<div class="flex flex-col gap-3 mt-auto sticky bottom-6">
<button class="flex w-full cursor-pointer items-center justify-center rounded-lg h-12 bg-primary hover:bg-primary/90 text-white gap-2 text-base font-bold shadow-md transition-all">
<span class="material-symbols-outlined">download</span>
                            Export Code
                        </button>
<div class="grid grid-cols-2 gap-3">
<button class="flex w-full cursor-pointer items-center justify-center rounded-lg h-10 bg-white dark:bg-[#1e293b] border border-neutral-border hover:bg-gray-50 dark:hover:bg-[#2a3649] text-[#111418] dark:text-white gap-2 text-sm font-semibold shadow-sm transition-all">
<span class="material-symbols-outlined text-lg">edit</span>
                                Edit
                            </button>
<button class="flex w-full cursor-pointer items-center justify-center rounded-lg h-10 bg-white dark:bg-[#1e293b] border border-neutral-border hover:bg-gray-50 dark:hover:bg-[#2a3649] text-[#111418] dark:text-white gap-2 text-sm font-semibold shadow-sm transition-all">
<span class="material-symbols-outlined text-lg">code</span>
                                JSON
                            </button>
</div>
</div>
</div>
</div>
</div>
</main>`;

export default function Page({
  searchParams,
}: {
  searchParams?: { dealId?: string };
}) {
  const dealId = searchParams?.dealId;
  if (dealId) {
    redirect(`/deals/${dealId}/underwriter`);
  }
  redirect("/deals");
  return null;
}
