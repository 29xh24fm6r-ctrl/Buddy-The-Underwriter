import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Document Template Vault - Buddy";
const FONT_LINKS = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "primary-dark": "#0e52b5",
                        "background-light": "#f6f7f8",
                        "background-dark": "#0f1115",
                        "surface-dark": "#1a1d23",
                        "surface-border": "#2e333d",
                        "text-muted": "#9ca3af",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "mono": ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
                    },
                    boxShadow: {
                        'glass': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.15)',
                    }
                },
            },
        }`;
const STYLES = [
  "body {\n            font-family: 'Inter', sans-serif;\n        }\n        /* Custom scrollbar for high density look */\n        ::-webkit-scrollbar {\n            width: 8px;\n            height: 8px;\n        }\n        ::-webkit-scrollbar-track {\n            background: #1a1d23;\n        }\n        ::-webkit-scrollbar-thumb {\n            background: #374151;\n            border-radius: 4px;\n        }\n        ::-webkit-scrollbar-thumb:hover {\n            background: #4b5563;\n        }"
];
const BODY_HTML = `<!-- Global Header -->
<header class="flex-none h-14 bg-surface-dark border-b border-surface-border flex items-center justify-between px-6 z-20">
<div class="flex items-center gap-8">
<div class="flex items-center gap-2">
<div class="size-6 bg-primary rounded flex items-center justify-center text-white font-bold text-xs">B</div>
<h1 class="text-white text-base font-bold tracking-tight">Buddy</h1>
</div>
<!-- Global Nav -->
<nav class="flex items-center gap-6">
<a class="text-sm font-medium text-text-muted hover:text-white transition-colors" href="#">Deals</a>
<a class="text-sm font-medium text-text-muted hover:text-white transition-colors" href="#">Intake</a>
<a class="text-sm font-medium text-text-muted hover:text-white transition-colors" href="#">Portfolio</a>
<a class="text-sm font-medium text-text-muted hover:text-white transition-colors" href="#">Committee</a>
<a class="text-sm font-medium text-text-muted hover:text-white transition-colors" href="#">Reporting</a>
<a class="text-sm font-medium text-text-muted hover:text-white transition-colors" href="#">Servicing</a>
<a class="text-sm font-medium text-white border-b-2 border-primary h-14 flex items-center" href="#">Admin</a>
</nav>
</div>
<!-- Right Header Actions -->
<div class="flex items-center gap-4">
<div class="relative w-64">
<span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
<input class="w-full bg-[#111316] border border-surface-border rounded-md py-1.5 pl-9 pr-3 text-sm text-white focus:ring-1 focus:ring-primary focus:border-primary placeholder-text-muted" placeholder="Global Search..." type="text"/>
</div>
<button class="text-text-muted hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">notifications</span>
</button>
<div class="size-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 border border-surface-border" data-alt="User Avatar Gradient"></div>
</div>
</header>
<!-- Main Content Grid -->
<div class="flex-1 flex overflow-hidden">
<!-- LEFT COLUMN: Library Navigation + Filters -->
<aside class="w-72 flex-none flex flex-col border-r border-surface-border bg-[#13161a] overflow-y-auto">
<!-- Admin Nav Card -->
<div class="p-4 border-b border-surface-border">
<h2 class="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Admin Library</h2>
<div class="flex flex-col gap-1">
<button class="flex items-center gap-3 px-3 py-2 rounded-md bg-primary/10 text-primary border border-primary/20">
<span class="material-symbols-outlined text-[20px]">description</span>
<span class="text-sm font-medium">Templates</span>
</button>
<button class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-dark text-text-muted hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">book</span>
<span class="text-sm font-medium">Reference Library</span>
</button>
<button class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-dark text-text-muted hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">data_object</span>
<span class="text-sm font-medium">Variables / Merge</span>
</button>
<button class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-dark text-text-muted hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">branding_watermark</span>
<span class="text-sm font-medium">Branding</span>
</button>
<button class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-dark text-text-muted hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">shield</span>
<span class="text-sm font-medium">Permissions</span>
</button>
<button class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-dark text-text-muted hover:text-white transition-colors">
<span class="material-symbols-outlined text-[20px]">history_edu</span>
<span class="text-sm font-medium">Audit</span>
</button>
</div>
</div>
<!-- Filter Controls -->
<div class="p-4 flex flex-col gap-4 border-b border-surface-border">
<div class="flex items-center justify-between">
<h2 class="text-xs font-semibold text-text-muted uppercase tracking-wider">Filters</h2>
<button class="text-[10px] text-primary hover:underline">Reset</button>
</div>
<div class="relative">
<span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">search</span>
<input class="w-full bg-surface-dark border border-surface-border rounded-md py-1.5 pl-8 pr-3 text-xs text-white focus:ring-1 focus:ring-primary placeholder-text-muted" placeholder="Search templates..." type="text"/>
</div>
<div class="space-y-3">
<div class="flex flex-col gap-1">
<label class="text-[10px] text-text-muted">Category</label>
<select class="w-full bg-surface-dark border border-surface-border rounded-md py-1.5 px-2 text-xs text-white focus:ring-1 focus:ring-primary">
<option>All Categories</option>
<option>Origination</option>
<option>Legal</option>
<option>Operations</option>
</select>
</div>
<div class="flex flex-col gap-1">
<label class="text-[10px] text-text-muted">Status</label>
<select class="w-full bg-surface-dark border border-surface-border rounded-md py-1.5 px-2 text-xs text-white focus:ring-1 focus:ring-primary">
<option>Any Status</option>
<option>Active</option>
<option>Draft</option>
<option>Deprecated</option>
</select>
</div>
<div class="flex flex-col gap-1">
<label class="text-[10px] text-text-muted">Doc Type</label>
<select class="w-full bg-surface-dark border border-surface-border rounded-md py-1.5 px-2 text-xs text-white focus:ring-1 focus:ring-primary">
<option>All Types</option>
<option>PDF</option>
<option>DOCX</option>
</select>
</div>
</div>
</div>
<!-- Quick Stats Card -->
<div class="p-4 mt-auto">
<div class="bg-surface-dark border border-surface-border rounded-lg p-3 shadow-glass">
<h3 class="text-xs font-medium text-text-muted mb-3 border-b border-surface-border pb-2">Vault Health</h3>
<div class="grid grid-cols-2 gap-3">
<div>
<p class="text-[10px] text-text-muted">Active</p>
<p class="text-lg font-bold text-white leading-tight">14</p>
</div>
<div>
<p class="text-[10px] text-text-muted">Drafts</p>
<p class="text-lg font-bold text-yellow-500 leading-tight">3</p>
</div>
<div>
<p class="text-[10px] text-text-muted">Policies</p>
<p class="text-lg font-bold text-white leading-tight">9</p>
</div>
<div>
<p class="text-[10px] text-text-muted">Last Publish</p>
<p class="text-xs font-semibold text-emerald-500 leading-tight">10:12 AM</p>
</div>
</div>
</div>
</div>
</aside>
<!-- CENTER COLUMN: PDF Output Templates -->
<main class="flex-1 flex flex-col min-w-0 bg-background-dark">
<!-- Section Header + Actions -->
<div class="h-16 flex-none flex items-center justify-between px-6 border-b border-surface-border bg-background-dark">
<div>
<h2 class="text-lg font-semibold text-white">PDF Output Templates</h2>
<p class="text-xs text-text-muted">Manage merge-ready templates for automated generation</p>
</div>
<div class="flex items-center gap-2">
<button class="flex items-center gap-1 px-3 py-1.5 rounded bg-surface-dark border border-surface-border text-xs font-medium hover:bg-white/5 transition-colors">
<span class="material-symbols-outlined text-[16px]">data_object</span>
                        Manage Fields
                    </button>
<button class="flex items-center gap-1 px-3 py-1.5 rounded bg-surface-dark border border-surface-border text-xs font-medium hover:bg-white/5 transition-colors">
<span class="material-symbols-outlined text-[16px]">upload_file</span>
                        Import Library
                    </button>
<button class="flex items-center gap-1 px-3 py-1.5 rounded bg-primary text-white text-xs font-medium hover:bg-primary-dark transition-colors shadow-sm">
<span class="material-symbols-outlined text-[16px]">add</span>
                        Upload New
                    </button>
</div>
</div>
<!-- Templates Table Area -->
<div class="flex-1 flex flex-col overflow-hidden">
<!-- Table Header -->
<div class="flex-none grid grid-cols-12 gap-4 px-6 py-2 border-b border-surface-border bg-surface-dark/50 text-[11px] font-semibold text-text-muted uppercase tracking-wider items-center">
<div class="col-span-4 pl-2">Template Name</div>
<div class="col-span-2">Category</div>
<div class="col-span-1">Type</div>
<div class="col-span-1">Version</div>
<div class="col-span-1">Status</div>
<div class="col-span-2">Updated</div>
<div class="col-span-1 text-right pr-2">Actions</div>
</div>
<!-- Scrollable Table Body -->
<div class="flex-1 overflow-y-auto">
<!-- Row 1: Selected/Open -->
<div class="group flex flex-col border-b border-primary/30 bg-primary/5">
<div class="grid grid-cols-12 gap-4 px-6 py-3 items-center hover:bg-white/5 cursor-pointer">
<div class="col-span-4 flex items-center gap-3 pl-2">
<span class="material-symbols-outlined text-primary text-[20px]">expand_more</span>
<div>
<p class="text-sm font-medium text-white">Term Sheet — Origination</p>
<p class="text-[10px] text-text-muted font-mono">TS-ORG-2024-STD</p>
</div>
</div>
<div class="col-span-2">
<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface-dark border border-surface-border text-text-muted">Origination</span>
</div>
<div class="col-span-1 flex items-center gap-1 text-xs text-blue-400">
<span class="material-symbols-outlined text-[16px]">description</span> DOCX
                            </div>
<div class="col-span-1">
<span class="px-1.5 py-0.5 rounded bg-surface-dark border border-surface-border text-[10px] font-mono text-white">v3.2</span>
</div>
<div class="col-span-1">
<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Active</span>
</div>
<div class="col-span-2 text-xs text-text-muted">
                                2h ago by <span class="text-white">Sarah J.</span>
</div>
<div class="col-span-1 flex justify-end gap-1 pr-2 opacity-100">
<button class="p-1 hover:bg-white/10 rounded text-text-muted hover:text-white"><span class="material-symbols-outlined text-[16px]">edit</span></button>
<button class="p-1 hover:bg-white/10 rounded text-text-muted hover:text-white"><span class="material-symbols-outlined text-[16px]">more_vert</span></button>
</div>
</div>
<!-- Expanded Drawer -->
<div class="px-6 pb-4 pl-14">
<div class="bg-surface-dark border border-surface-border rounded-lg p-4 shadow-inner">
<div class="flex justify-between items-start mb-4">
<div>
<h4 class="text-xs font-semibold text-white uppercase tracking-wider mb-1">Version Control</h4>
<p class="text-xs text-text-muted">Current: <span class="text-white font-mono">v3.2</span> (Active) • Previous: <span class="text-text-muted font-mono">v3.1</span></p>
</div>
<div class="flex gap-2">
<button class="px-3 py-1.5 bg-background-dark border border-surface-border rounded hover:bg-white/5 text-xs text-white">View Diff</button>
<button class="px-3 py-1.5 bg-background-dark border border-surface-border rounded hover:bg-white/5 text-xs text-white">Lock Version</button>
</div>
</div>
<div class="grid grid-cols-2 gap-6">
<div class="space-y-2">
<div class="flex justify-between items-end">
<span class="text-[10px] text-text-muted uppercase">Change Log</span>
<span class="text-[10px] text-text-muted">Today, 10:45 AM</span>
</div>
<div class="p-2 bg-background-dark border border-surface-border rounded text-xs text-gray-300 font-mono">
                                            &gt; Updated interest rate clause per legal<br/>
                                            &gt; Fixed formatting on signature block
                                        </div>
</div>
<div class="space-y-2">
<div class="flex justify-between items-end">
<span class="text-[10px] text-text-muted uppercase">Merge Field Health</span>
<span class="text-[10px] text-emerald-500 font-medium">98% Coverage</span>
</div>
<div class="w-full bg-surface-border rounded-full h-1.5">
<div class="bg-emerald-500 h-1.5 rounded-full" style="width: 98%"></div>
</div>
<div class="flex gap-2 mt-2">
<button class="flex-1 py-1.5 bg-primary/20 text-primary border border-primary/30 rounded hover:bg-primary/30 text-xs font-medium">Test with Sample</button>
<button class="flex-1 py-1.5 bg-background-dark text-white border border-surface-border rounded hover:bg-white/5 text-xs font-medium">Test with Deal...</button>
</div>
</div>
</div>
<div class="mt-3 pt-3 border-t border-surface-border flex items-center gap-2">
<span class="material-symbols-outlined text-text-muted text-[14px]">history</span>
<span class="text-[10px] text-text-muted font-mono">Last render: Success (142ms) - generated by system-automation</span>
</div>
</div>
</div>
</div>
<!-- Row 2 -->
<div class="group grid grid-cols-12 gap-4 px-6 py-3 border-b border-surface-border items-center hover:bg-surface-dark/50 transition-colors">
<div class="col-span-4 flex items-center gap-3 pl-2">
<span class="material-symbols-outlined text-text-muted text-[20px] group-hover:text-white transition-colors">chevron_right</span>
<div>
<p class="text-sm font-medium text-white">Deficiency Letter — Ops</p>
<p class="text-[10px] text-text-muted font-mono">LTR-DEF-OPS-V1</p>
</div>
</div>
<div class="col-span-2">
<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface-dark border border-surface-border text-text-muted">Operations</span>
</div>
<div class="col-span-1 flex items-center gap-1 text-xs text-blue-400">
<span class="material-symbols-outlined text-[16px]">description</span> DOCX
                        </div>
<div class="col-span-1">
<span class="px-1.5 py-0.5 rounded bg-surface-dark border border-surface-border text-[10px] font-mono text-white">v1.9</span>
</div>
<div class="col-span-1">
<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Active</span>
</div>
<div class="col-span-2 text-xs text-text-muted">
                            Yesterday by <span class="text-white">Mike R.</span>
</div>
<div class="col-span-1 flex justify-end gap-1 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-1 hover:bg-white/10 rounded text-text-muted hover:text-white"><span class="material-symbols-outlined text-[16px]">download</span></button>
<button class="p-1 hover:bg-white/10 rounded text-text-muted hover:text-white"><span class="material-symbols-outlined text-[16px]">more_vert</span></button>
</div>
</div>
<!-- Row 3 -->
<div class="group grid grid-cols-12 gap-4 px-6 py-3 border-b border-surface-border items-center hover:bg-surface-dark/50 transition-colors bg-surface-dark/20">
<div class="col-span-4 flex items-center gap-3 pl-2">
<span class="material-symbols-outlined text-text-muted text-[20px] group-hover:text-white transition-colors">chevron_right</span>
<div>
<p class="text-sm font-medium text-text-muted">Default Notice — Legal</p>
<p class="text-[10px] text-text-muted font-mono">NOT-DEF-LEG-V2</p>
</div>
</div>
<div class="col-span-2">
<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface-dark border border-surface-border text-text-muted">Legal</span>
</div>
<div class="col-span-1 flex items-center gap-1 text-xs text-text-muted">
<span class="material-symbols-outlined text-[16px]">description</span> DOCX
                        </div>
<div class="col-span-1">
<span class="px-1.5 py-0.5 rounded bg-surface-dark border border-surface-border text-[10px] font-mono text-text-muted">v2.1</span>
</div>
<div class="col-span-1">
<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-500 border border-red-500/20">Deprecated</span>
</div>
<div class="col-span-2 text-xs text-text-muted">
                            Oct 12 by <span class="text-text-muted">Admin</span>
</div>
<div class="col-span-1 flex justify-end gap-1 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-1 hover:bg-white/10 rounded text-text-muted hover:text-white"><span class="material-symbols-outlined text-[16px]">restore</span></button>
<button class="p-1 hover:bg-white/10 rounded text-text-muted hover:text-white"><span class="material-symbols-outlined text-[16px]">more_vert</span></button>
</div>
</div>
</div>
</div>
</main>
<!-- RIGHT COLUMN: Test Render + Policy Library -->
<aside class="w-80 flex-none flex flex-col border-l border-surface-border bg-[#13161a] overflow-y-auto">
<!-- Test Render Panel -->
<div class="p-4 border-b border-surface-border">
<div class="flex items-center gap-2 mb-4">
<span class="material-symbols-outlined text-primary text-[20px]">play_circle</span>
<h3 class="text-sm font-semibold text-white">Test Render</h3>
</div>
<div class="space-y-3">
<div>
<label class="block text-[10px] font-medium text-text-muted mb-1.5">Select Deal Context</label>
<select class="w-full bg-surface-dark border border-surface-border rounded text-xs text-white py-2 px-3 focus:ring-1 focus:ring-primary">
<option>Deal #24-902 (Acme Corp)</option>
<option>Deal #24-885 (Globex)</option>
</select>
</div>
<div>
<label class="block text-[10px] font-medium text-text-muted mb-1.5">Output Format</label>
<div class="grid grid-cols-2 gap-2">
<button class="flex items-center justify-center gap-2 py-1.5 border border-primary bg-primary/10 rounded text-xs text-primary font-medium">
                                 PDF
                             </button>
<button class="flex items-center justify-center gap-2 py-1.5 border border-surface-border bg-surface-dark rounded text-xs text-text-muted hover:text-white">
                                 DOCX
                             </button>
</div>
</div>
<div class="relative group mt-2">
<div class="h-32 bg-surface-dark border border-surface-border border-dashed rounded flex flex-col items-center justify-center gap-2" data-alt="Preview Area Placeholder Pattern" style="background-image: radial-gradient(#2e333d 1px, transparent 1px); background-size: 10px 10px;">
<span class="material-symbols-outlined text-text-muted opacity-50 text-[32px]">visibility</span>
<span class="text-[10px] text-text-muted">Preview not generated</span>
</div>
<div class="absolute bottom-2 right-2 flex gap-1">
<span class="material-symbols-outlined text-yellow-500 text-[16px]" title="Warnings present">warning</span>
</div>
</div>
<button class="w-full py-2 bg-primary hover:bg-primary-dark text-white text-xs font-bold rounded shadow-md transition-all flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-[16px]">bolt</span> Generate Preview
                    </button>
</div>
</div>
<!-- Merge Field Health Compact -->
<div class="p-4 border-b border-surface-border">
<h3 class="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Field Health</h3>
<div class="bg-surface-dark border border-surface-border rounded p-3">
<div class="flex justify-between items-center mb-2">
<span class="text-xs text-text-muted">Coverage</span>
<span class="text-xs font-bold text-emerald-500">98%</span>
</div>
<div class="w-full bg-surface-border rounded-full h-1.5 mb-3">
<div class="bg-emerald-500 h-1.5 rounded-full" style="width: 98%"></div>
</div>
<div class="space-y-1">
<div class="flex justify-between text-[10px]">
<span class="text-text-muted">Missing Fields</span>
<span class="text-red-400 font-mono">2</span>
</div>
<div class="flex justify-between text-[10px]">
<span class="text-text-muted">Deprecated Fields</span>
<span class="text-yellow-500 font-mono">1</span>
</div>
</div>
<div class="flex gap-2 mt-3">
<button class="flex-1 text-[10px] py-1 bg-surface-border/50 text-text-muted hover:text-white rounded border border-transparent hover:border-surface-border">Map Fields</button>
<button class="flex-1 text-[10px] py-1 bg-surface-border/50 text-text-muted hover:text-white rounded border border-transparent hover:border-surface-border">View Log</button>
</div>
</div>
</div>
<!-- Policy Library List -->
<div class="flex-1 flex flex-col overflow-hidden">
<div class="p-4 pb-2 bg-[#13161a] sticky top-0 z-10">
<div class="flex items-center justify-between mb-2">
<h3 class="text-xs font-semibold text-text-muted uppercase tracking-wider">Reference / Policy</h3>
<button class="text-primary hover:text-primary-dark"><span class="material-symbols-outlined text-[16px]">add_circle</span></button>
</div>
<div class="relative">
<span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-[14px]">search</span>
<input class="w-full bg-surface-dark border border-surface-border rounded-sm py-1 pl-7 pr-2 text-[10px] text-white focus:ring-0 focus:border-primary placeholder-text-muted" placeholder="Search policies..." type="text"/>
</div>
</div>
<div class="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
<!-- Policy Item 1 -->
<div class="p-3 bg-surface-dark border border-surface-border rounded hover:border-primary/50 transition-colors group cursor-pointer">
<div class="flex justify-between items-start mb-1">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-red-400 text-[18px]">picture_as_pdf</span>
<span class="text-xs font-medium text-white line-clamp-1">Credit Policy 2025</span>
</div>
<button class="text-text-muted hover:text-white opacity-0 group-hover:opacity-100"><span class="material-symbols-outlined text-[16px]">download</span></button>
</div>
<div class="flex items-center justify-between mt-2">
<span class="text-[10px] text-text-muted font-mono">v7 • Final</span>
<span class="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 rounded">Active</span>
</div>
</div>
<!-- Policy Item 2 -->
<div class="p-3 bg-surface-dark border border-surface-border rounded hover:border-primary/50 transition-colors group cursor-pointer">
<div class="flex justify-between items-start mb-1">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-red-400 text-[18px]">picture_as_pdf</span>
<span class="text-xs font-medium text-white line-clamp-1">Delegation of Authority Matrix</span>
</div>
<button class="text-text-muted hover:text-white opacity-0 group-hover:opacity-100"><span class="material-symbols-outlined text-[16px]">download</span></button>
</div>
<div class="flex items-center justify-between mt-2">
<span class="text-[10px] text-text-muted font-mono">v4 • Final</span>
<span class="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 rounded">Active</span>
</div>
</div>
<!-- Policy Item 3 -->
<div class="p-3 bg-surface-dark border border-surface-border rounded hover:border-primary/50 transition-colors group cursor-pointer">
<div class="flex justify-between items-start mb-1">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-red-400 text-[18px]">picture_as_pdf</span>
<span class="text-xs font-medium text-white line-clamp-1">Legal Playbook — Defaults</span>
</div>
<button class="text-text-muted hover:text-white opacity-0 group-hover:opacity-100"><span class="material-symbols-outlined text-[16px]">download</span></button>
</div>
<div class="flex items-center justify-between mt-2">
<span class="text-[10px] text-text-muted font-mono">v5 • Final</span>
<span class="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 rounded">Active</span>
</div>
</div>
<!-- Policy Item 4 -->
<div class="p-3 bg-surface-dark border border-surface-border rounded hover:border-primary/50 transition-colors group cursor-pointer opacity-70">
<div class="flex justify-between items-start mb-1">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-red-400 text-[18px]">picture_as_pdf</span>
<span class="text-xs font-medium text-white line-clamp-1">Risk Appetite Statement</span>
</div>
<button class="text-text-muted hover:text-white opacity-0 group-hover:opacity-100"><span class="material-symbols-outlined text-[16px]">download</span></button>
</div>
<div class="flex items-center justify-between mt-2">
<span class="text-[10px] text-text-muted font-mono">v2 • Draft</span>
<span class="text-[10px] text-yellow-500 bg-yellow-500/10 px-1.5 rounded">Draft</span>
</div>
</div>
</div>
</div>
</aside>
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
