import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Buddy the Underwriter - Exceptions Review";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `</script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet"/>
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
              "background-dark": "#101822",
              "surface-dark": "#1c2027",
              "card-dark": "#282f39",
            },
            fontFamily: {
              "display": ["Inter", "sans-serif"]
            },
          },
        },
      }`;
const STYLES: string[] = [];
const BODY_HTML = `<!-- Background Layer (Portfolio Command Bridge) -->
<!-- We apply a visual dimming effect via an overlay div later, but this is the structural content -->
<div class="flex-1 flex flex-col h-full w-full relative z-0">
<!-- Top Navigation -->
<header class="flex items-center justify-between whitespace-nowrap border-b border-solid border-[#282f39] bg-[#111418] px-8 py-3 shrink-0">
<div class="flex items-center gap-8">
<div class="flex items-center gap-3 text-white">
<div class="size-8 flex items-center justify-center bg-primary rounded-lg text-white">
<span class="material-symbols-outlined text-[20px]">security</span>
</div>
<h2 class="text-white text-lg font-bold leading-tight tracking-[-0.015em]">Buddy the Underwriter</h2>
</div>
<label class="flex flex-col min-w-40 !h-9 max-w-64">
<div class="flex w-full flex-1 items-stretch rounded-lg h-full ring-1 ring-[#282f39]">
<div class="text-[#9da8b9] flex border-none bg-[#1c2027] items-center justify-center pl-3 rounded-l-lg border-r-0">
<span class="material-symbols-outlined text-[20px]">search</span>
</div>
<input class="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-0 border-none bg-[#1c2027] focus:border-none h-full placeholder:text-[#9da8b9] px-3 rounded-l-none border-l-0 pl-2 text-sm font-normal leading-normal" placeholder="Search deals, documents..." value=""/>
</div>
</label>
</div>
<div class="flex flex-1 justify-end gap-6 items-center">
<nav class="flex items-center gap-6 mr-4">
<a class="text-[#9da8b9] hover:text-white text-sm font-medium leading-normal transition-colors" href="#">Deals</a>
<a class="text-[#9da8b9] hover:text-white text-sm font-medium leading-normal transition-colors" href="#">Intake</a>
<a class="text-white text-sm font-bold leading-normal border-b-2 border-primary py-4" href="#">Portfolio</a>
<a class="text-[#9da8b9] hover:text-white text-sm font-medium leading-normal transition-colors" href="#">Committee</a>
<a class="text-[#9da8b9] hover:text-white text-sm font-medium leading-normal transition-colors" href="#">Reporting</a>
</nav>
<div class="flex gap-2">
<button class="flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-[#282f39] text-white transition-colors relative">
<span class="material-symbols-outlined text-[20px]">notifications</span>
<div class="absolute top-2 right-2 size-2 bg-red-500 rounded-full border border-[#111418]"></div>
</button>
<div class="bg-center bg-no-repeat bg-cover rounded-full size-9 ring-2 ring-[#282f39]" data-alt="User Avatar Profile Picture" style='background-image: url("https://lh3.googleusercontent.com/aida-public/AB6AXuAmuRjpHbKFW8LopvpCY9wnFsoZxJRNGZ5iIA0GyX_BHLhh4P3m1HtZzbh76T31IA9VFVTU02gYWN5i1ZN7bX74PfEmFiy3O3QinxNgX7f3JSLCY7HnT84l3HJbcIalm1Reya_1LYSKb5abXG28umtsL8cX_92ApU355fL_yu96gouqngNM0VJrjBfJasCVMrBm5z_JFbGH0pz3dEl934OmP6V5hJhEEwcertH6pbLMuVnIja87GZGkeGtHUjrv1f1I0Ur-urneafk");'></div>
</div>
</div>
</header>
<!-- Main Content Area -->
<main class="flex-1 overflow-y-auto bg-[#111418] px-8 py-6 pb-20 scrollbar-hide">
<div class="max-w-[1600px] mx-auto flex flex-col gap-6">
<!-- Breadcrumbs -->
<div class="flex items-center gap-2 text-sm">
<a class="text-[#9da8b9] hover:text-primary transition-colors font-medium" href="#">Portfolio</a>
<span class="material-symbols-outlined text-[#505a69] text-[16px]">chevron_right</span>
<a class="text-[#9da8b9] hover:text-primary transition-colors font-medium" href="#">Loan 10249</a>
<span class="material-symbols-outlined text-[#505a69] text-[16px]">chevron_right</span>
<span class="text-white font-medium">Exceptions</span>
</div>
<!-- Page Header -->
<div class="flex justify-between items-end">
<div class="flex flex-col gap-1">
<h1 class="text-white text-3xl font-bold tracking-tight">Exceptions &amp; Change Review</h1>
<p class="text-[#9da8b9] text-sm">Compare changes to the last approved snapshot. Approve, escalate, or log exceptions.</p>
</div>
<div class="flex gap-3">
<button class="flex items-center gap-2 px-4 py-2 bg-[#282f39] text-white text-sm font-medium rounded-lg hover:bg-[#323b47] transition-colors border border-[#3b4554]">
<span class="material-symbols-outlined text-[18px]">history</span>
                            View History
                        </button>
</div>
</div>
<!-- KPI Strip -->
<div class="grid grid-cols-7 gap-4">
<div class="bg-card-dark rounded-lg p-4 border border-[#282f39]">
<p class="text-[#9da8b9] text-xs font-medium uppercase tracking-wider mb-1">Total Exposure</p>
<p class="text-white text-xl font-bold font-mono">$4.2B</p>
<p class="text-emerald-500 text-xs font-medium mt-1 flex items-center gap-0.5"><span class="material-symbols-outlined text-[14px]">trending_up</span> +2.1%</p>
</div>
<div class="bg-card-dark rounded-lg p-4 border border-[#282f39]">
<p class="text-[#9da8b9] text-xs font-medium uppercase tracking-wider mb-1">Annual Profit</p>
<p class="text-white text-xl font-bold font-mono">$320M</p>
<p class="text-emerald-500 text-xs font-medium mt-1 flex items-center gap-0.5"><span class="material-symbols-outlined text-[14px]">trending_up</span> +5.4%</p>
</div>
<div class="bg-card-dark rounded-lg p-4 border border-[#282f39]">
<p class="text-[#9da8b9] text-xs font-medium uppercase tracking-wider mb-1">% Variable</p>
<p class="text-white text-xl font-bold font-mono">42%</p>
<p class="text-orange-500 text-xs font-medium mt-1 flex items-center gap-0.5"><span class="material-symbols-outlined text-[14px]">trending_down</span> -1.2%</p>
</div>
<div class="bg-card-dark rounded-lg p-4 border border-[#282f39]">
<p class="text-[#9da8b9] text-xs font-medium uppercase tracking-wider mb-1">Watchlist</p>
<p class="text-white text-xl font-bold font-mono">12</p>
<p class="text-red-500 text-xs font-medium mt-1 flex items-center gap-0.5"><span class="material-symbols-outlined text-[14px]">warning</span> +2</p>
</div>
<div class="bg-card-dark rounded-lg p-4 border border-[#282f39]">
<p class="text-[#9da8b9] text-xs font-medium uppercase tracking-wider mb-1">Near Breach</p>
<p class="text-white text-xl font-bold font-mono">3</p>
<p class="text-orange-400 text-xs font-medium mt-1 flex items-center gap-0.5"><span class="material-symbols-outlined text-[14px]">add</span> +1</p>
</div>
<div class="bg-card-dark rounded-lg p-4 border border-[#282f39]">
<p class="text-[#9da8b9] text-xs font-medium uppercase tracking-wider mb-1">IO Loans</p>
<p class="text-white text-xl font-bold font-mono">15%</p>
<p class="text-[#9da8b9] text-xs font-medium mt-1">--</p>
</div>
<div class="bg-card-dark rounded-lg p-4 border border-[#282f39]">
<p class="text-[#9da8b9] text-xs font-medium uppercase tracking-wider mb-1">Rate Resets</p>
<p class="text-white text-xl font-bold font-mono">8</p>
<p class="text-orange-400 text-xs font-medium mt-1 flex items-center gap-0.5"><span class="material-symbols-outlined text-[14px]">add</span> +2</p>
</div>
</div>
<!-- Table Context -->
<div class="rounded-lg border border-[#3b4554] bg-[#1c2027] overflow-hidden">
<table class="w-full text-left border-collapse">
<thead>
<tr class="bg-[#242932] border-b border-[#3b4554]">
<th class="px-6 py-3 text-[#9da8b9] text-xs font-semibold uppercase tracking-wider">Loan/Deal Name</th>
<th class="px-6 py-3 text-[#9da8b9] text-xs font-semibold uppercase tracking-wider text-right">UPB</th>
<th class="px-6 py-3 text-[#9da8b9] text-xs font-semibold uppercase tracking-wider">Rate Type</th>
<th class="px-6 py-3 text-[#9da8b9] text-xs font-semibold uppercase tracking-wider">DSCR</th>
<th class="px-6 py-3 text-[#9da8b9] text-xs font-semibold uppercase tracking-wider">LTV</th>
<th class="px-6 py-3 text-[#9da8b9] text-xs font-semibold uppercase tracking-wider">Covenant Status</th>
<th class="px-6 py-3 text-[#9da8b9] text-xs font-semibold uppercase tracking-wider text-right">Profit (Ann)</th>
<th class="px-6 py-3 text-[#9da8b9] text-xs font-semibold uppercase tracking-wider text-right">Updated</th>
</tr>
</thead>
<tbody class="divide-y divide-[#282f39]">
<!-- Row 1: Selected Context -->
<tr class="bg-primary/10 border-l-4 border-l-primary">
<td class="px-6 py-4">
<div class="flex items-center gap-3">
<div class="bg-cover bg-center size-10 rounded bg-[#282f39]" data-alt="Highland Retail Village Building Thumbnail" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuCnqQFQCVP6Wnk60WuW4YN3xsmMu3zRxclui74nAmCsSOE-pfBw1kSXr9mAeqCo1itfQyJ11lRYEUfdL7yFezG-gcR6Va0VcNTEPDJe242xi9sFYjl5a7L6ICFmcLCjCV5Q7_FZfb3tngwn7Um_q3XQ42vZpf1ESTW-yZKI-N2uot1wQe6eRcw9X7dyvMcdVyc5-3RVhrt15DVq_GoHPAu7JBAzp0ymxtyroNdMz-dSE45CvusffBOrBue94Hsho7LbgS46QnOGsLc');"></div>
<div>
<p class="text-white font-medium text-sm">Highland Retail Village</p>
<p class="text-[#9da8b9] text-xs">Seattle, WA • Retail</p>
</div>
</div>
</td>
<td class="px-6 py-4 text-right text-white text-sm font-mono">$42.5M</td>
<td class="px-6 py-4 text-white text-sm">Fixed</td>
<td class="px-6 py-4 text-white text-sm font-mono">1.18x</td>
<td class="px-6 py-4 text-white text-sm font-mono">72%</td>
<td class="px-6 py-4">
<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20">
                                        Breach Watch
                                    </span>
</td>
<td class="px-6 py-4 text-right text-white text-sm font-mono">$1.2M</td>
<td class="px-6 py-4 text-right text-white text-sm">Today</td>
</tr>
<!-- Row 2 -->
<tr class="hover:bg-[#242932] transition-colors">
<td class="px-6 py-4">
<div class="flex items-center gap-3">
<div class="bg-cover bg-center size-10 rounded bg-[#282f39]" data-alt="Office Building Thumbnail" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuCd2_nv6uXclBVY3BgwT7YxqmrzLuIzmBVCXFNYloHZhdi03JguIV1wDYyo_tkhKBRIjqAlDYWGsJ7gpAOCp7qlWILdGjmPYT2d04KqxEISVUTCLIj9CAIUtwJDAx5myyHvmjG7B_4lTGlGqQmrwPXdrWy0wjZDDfBtS0WKY68SxL-LQY-JUGXQ_eX3QfdYD_rY3jdXlEhlpfLoqWhilbyaYbYryY2ksLQ8g79smaCxLZpT4enZnOOSrloyK3U1zpQzVo7pzPX8H-A');"></div>
<div>
<p class="text-[#9da8b9] font-medium text-sm">Onyx Tower Layout</p>
<p class="text-[#505a69] text-xs">Austin, TX • Office</p>
</div>
</div>
</td>
<td class="px-6 py-4 text-right text-[#9da8b9] text-sm font-mono">$128.0M</td>
<td class="px-6 py-4 text-[#9da8b9] text-sm">Floating</td>
<td class="px-6 py-4 text-[#9da8b9] text-sm font-mono">1.45x</td>
<td class="px-6 py-4 text-[#9da8b9] text-sm font-mono">65%</td>
<td class="px-6 py-4">
<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                        Compliant
                                    </span>
</td>
<td class="px-6 py-4 text-right text-[#9da8b9] text-sm font-mono">$3.4M</td>
<td class="px-6 py-4 text-right text-[#9da8b9] text-sm">Oct 24</td>
</tr>
<!-- Row 3 -->
<tr class="hover:bg-[#242932] transition-colors">
<td class="px-6 py-4">
<div class="flex items-center gap-3">
<div class="bg-cover bg-center size-10 rounded bg-[#282f39]" data-alt="Warehouse Thumbnail" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuCi7gzy8O7PzBG7VJ0QghTsRc9hkRXW7U6DNEEcwQexpbT2qkva6a_CbViYepyTAKQSYJX0c-bDzaNgrpZUJTzusHXv4jxfOADqUbiTjs1naHkv3uUkQhhgfjjv79T0SN8qnRJw1d0g6YGXm5LTc4bqZKprpnwdxczJPro6pR5hZhf1uuRVPl1-_-qZpO-TfSFKLTWdmbFMXoKbBe64Tiel76ATTOxuTbZZK9H_VBqFgG04spfnaEzrVudJIwLBcK6iVLye9sSL1FE');"></div>
<div>
<p class="text-[#9da8b9] font-medium text-sm">Logistics Park South</p>
<p class="text-[#505a69] text-xs">Atlanta, GA • Industrial</p>
</div>
</div>
</td>
<td class="px-6 py-4 text-right text-[#9da8b9] text-sm font-mono">$18.2M</td>
<td class="px-6 py-4 text-[#9da8b9] text-sm">Fixed</td>
<td class="px-6 py-4 text-[#9da8b9] text-sm font-mono">2.10x</td>
<td class="px-6 py-4 text-[#9da8b9] text-sm font-mono">55%</td>
<td class="px-6 py-4">
<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                        Compliant
                                    </span>
</td>
<td class="px-6 py-4 text-right text-[#9da8b9] text-sm font-mono">$850k</td>
<td class="px-6 py-4 text-right text-[#9da8b9] text-sm">Oct 22</td>
</tr>
</tbody>
</table>
</div>
</div>
</main>
</div>
<!-- Backdrop Blur Overlay -->
<div aria-hidden="true" class="fixed inset-0 z-40 bg-[#0f1115]/60 backdrop-blur-[2px]"></div>
<!-- Exception Review Drawer -->
<aside class="fixed inset-y-0 right-0 z-50 w-full max-w-[660px] bg-surface-dark border-l border-[#3b4554] shadow-2xl flex flex-col animate-slide-in">
<!-- Drawer Header -->
<div class="flex-none p-6 border-b border-[#282f39] bg-surface-dark z-10">
<div class="flex items-start justify-between mb-4">
<div class="flex gap-4">
<div class="size-14 rounded-lg bg-[#282f39] bg-cover bg-center border border-[#3b4554]" data-alt="Highland Retail Village Asset Image" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuAVsBOvYuEPpiqFGxanmlUdHrZXs0Tic2ofsq6XSMQAJdjjicwJXkywBC7kemY0wSnG0Gj5d0QiqLw1TtKdB8ovcMwHIqXJeeB69Fxj9legvHlT2IBC6BKvBejZPuUKl99wtFC_cfHoMC2uxjxNowxHdvJdlRgI_ANmhQZ3R1rOTNtlW4zhMIkbxGbYMYRdMT9dGEahBaz3N0sQnt4cUbPyoRJMWhNSJrSRMBjNVBTzzXUrjoUkBt6gC18bHKDmCdJgDJ5yDwnC5DU');"></div>
<div>
<div class="flex items-center gap-2 mb-1">
<h2 class="text-xl font-bold text-white tracking-tight">Highland Retail Village</h2>
<span class="material-symbols-outlined text-[#9da8b9] text-[16px]">open_in_new</span>
</div>
<div class="flex items-center gap-3 text-xs text-[#9da8b9]">
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">location_on</span> Seattle, WA</span>
<span class="w-1 h-1 rounded-full bg-[#3b4554]"></span>
<span>Retail Anchor</span>
<span class="w-1 h-1 rounded-full bg-[#3b4554]"></span>
<span>Sponsor: Highland Capital</span>
</div>
</div>
</div>
<button class="text-[#9da8b9] hover:text-white transition-colors">
<span class="material-symbols-outlined">close</span>
</button>
</div>
<div class="flex items-center justify-between">
<div class="flex gap-2">
<span class="inline-flex items-center px-2 py-1 rounded bg-[#282f39] border border-[#3b4554] text-[11px] font-semibold text-[#9da8b9] uppercase tracking-wide">Active</span>
<span class="inline-flex items-center px-2 py-1 rounded bg-orange-500/10 border border-orange-500/20 text-[11px] font-semibold text-orange-500 uppercase tracking-wide">Watchlist</span>
<span class="inline-flex items-center px-2 py-1 rounded bg-red-500 text-[11px] font-bold text-white uppercase tracking-wide shadow-sm shadow-red-900/20">Exceptions: 6 Open</span>
</div>
<div class="text-xs text-[#9da8b9] text-right">
<p class="mb-0.5">Comparing to <strong class="text-white">Snapshot v1.3</strong></p>
<p class="opacity-70">Approved Oct 08 • Sarah Vance</p>
</div>
</div>
</div>
<!-- Scrollable Content -->
<div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#3b4554] scrollbar-track-transparent">
<!-- Section A: Materiality Summary -->
<div class="p-6 pb-2 border-b border-[#282f39] bg-[#1a1d24]">
<h3 class="text-xs font-semibold text-[#9da8b9] uppercase tracking-wider mb-3">Materiality Summary</h3>
<div class="grid grid-cols-3 gap-3">
<!-- Metric Card: DSCR -->
<div class="bg-[#242932] border border-[#3b4554] rounded p-3 flex flex-col gap-1">
<div class="flex justify-between items-start">
<span class="text-[11px] font-medium text-[#9da8b9]">DSCR</span>
<span class="size-2 rounded-full bg-red-500"></span>
</div>
<div class="flex items-baseline gap-1.5 mt-1">
<span class="text-sm font-bold text-white font-mono">1.18x</span>
<span class="text-[10px] text-red-400 font-mono">▼ 12.5%</span>
</div>
<span class="text-[10px] text-[#505a69] font-mono">Was 1.35x</span>
</div>
<!-- Metric Card: LTV -->
<div class="bg-[#242932] border border-[#3b4554] rounded p-3 flex flex-col gap-1">
<div class="flex justify-between items-start">
<span class="text-[11px] font-medium text-[#9da8b9]">LTV</span>
<span class="size-2 rounded-full bg-orange-500"></span>
</div>
<div class="flex items-baseline gap-1.5 mt-1">
<span class="text-sm font-bold text-white font-mono">72.0%</span>
<span class="text-[10px] text-orange-400 font-mono">▲ 4.0%</span>
</div>
<span class="text-[10px] text-[#505a69] font-mono">Was 68.0%</span>
</div>
<!-- Metric Card: Profit -->
<div class="bg-[#242932] border border-[#3b4554] rounded p-3 flex flex-col gap-1">
<div class="flex justify-between items-start">
<span class="text-[11px] font-medium text-[#9da8b9]">Profit (Ann)</span>
<span class="size-2 rounded-full bg-emerald-500"></span>
</div>
<div class="flex items-baseline gap-1.5 mt-1">
<span class="text-sm font-bold text-white font-mono">$1.2M</span>
<span class="text-[10px] text-emerald-400 font-mono">▲ 2.1%</span>
</div>
<span class="text-[10px] text-[#505a69] font-mono">Was $1.18M</span>
</div>
</div>
</div>
<!-- Section B: Exceptions Queue -->
<div class="p-6 bg-[#181b21]">
<div class="flex items-center justify-between mb-4">
<h3 class="text-sm font-bold text-white">Exceptions Queue <span class="text-[#505a69] ml-1 font-normal">(6)</span></h3>
<div class="flex gap-2 text-xs">
<button class="text-primary font-medium hover:underline">Select All</button>
</div>
</div>
<div class="flex flex-col gap-3">
<!-- Exception Card 1: Expanded / Active -->
<div class="relative rounded-lg border border-primary/50 bg-[#1c2027] shadow-lg overflow-hidden group">
<!-- Left colored stripe for active state -->
<div class="absolute top-0 bottom-0 left-0 w-1 bg-primary"></div>
<!-- Card Header -->
<div class="p-4 cursor-pointer hover:bg-[#242932] transition-colors">
<div class="flex justify-between items-start mb-2">
<div class="flex gap-3 items-center">
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-500 border border-red-500/20">
<span class="material-symbols-outlined text-[12px]">error</span> Breach
                                    </span>
<span class="text-xs text-[#505a69] font-mono">Today 09:41 AM</span>
</div>
<input checked="" class="rounded border-[#3b4554] bg-[#111418] text-primary focus:ring-0 focus:ring-offset-0 size-4 cursor-pointer" type="checkbox"/>
</div>
<h4 class="text-sm font-semibold text-white mb-1">DSCR Covenant Breach</h4>
<p class="text-xs text-[#9da8b9]">Debt Service Coverage Ratio fell below 1.25x covenant threshold.</p>
</div>
<!-- Section C: Deep Diff Inspector (Inline) -->
<div class="bg-[#15181e] border-t border-[#282f39] p-4">
<div class="grid grid-cols-2 gap-4 mb-4">
<div>
<p class="text-[10px] uppercase tracking-wider text-[#505a69] font-semibold mb-1">Previous (Snapshot)</p>
<div class="bg-[#242932] rounded p-2 border border-[#3b4554]">
<p class="text-sm font-mono text-[#9da8b9] line-through decoration-red-500/50">1.35x</p>
<p class="text-[10px] text-[#505a69] mt-1">From Q3 Financials</p>
</div>
</div>
<div>
<p class="text-[10px] uppercase tracking-wider text-[#505a69] font-semibold mb-1">New Value</p>
<div class="bg-[#242932] rounded p-2 border border-primary/30 relative">
<p class="text-sm font-mono text-white">1.18x</p>
<p class="text-[10px] text-primary mt-1 flex items-center gap-1">
<span class="material-symbols-outlined text-[10px]">auto_awesome</span>
                                            OCR 98% Confidence
                                        </p>
<div class="absolute top-2 right-2 size-2 rounded-full bg-primary animate-pulse"></div>
</div>
</div>
</div>
<!-- AI Reason -->
<div class="bg-primary/5 rounded border border-primary/10 p-3 mb-4">
<div class="flex gap-2 items-start">
<span class="material-symbols-outlined text-primary text-[16px] mt-0.5">psychology</span>
<div>
<p class="text-xs text-white font-medium mb-0.5">Why Buddy flagged this</p>
<p class="text-xs text-[#9da8b9] leading-relaxed">
                                            The drop in NOI due to "Circuit City" vacancy (Page 4 of Rent Roll) caused DSCR to breach the 1.25x threshold defined in the Credit Agreement.
                                        </p>
</div>
</div>
</div>
<div class="flex gap-2">
<button class="flex-1 bg-[#282f39] hover:bg-[#323b47] text-white text-xs font-medium py-2 rounded border border-[#3b4554] flex items-center justify-center gap-2 transition-colors">
<span class="material-symbols-outlined text-[14px]">visibility</span> View Source
                                </button>
<button class="flex-1 bg-[#282f39] hover:bg-[#323b47] text-white text-xs font-medium py-2 rounded border border-[#3b4554] flex items-center justify-center gap-2 transition-colors">
<span class="material-symbols-outlined text-[14px]">edit_note</span> Add Note
                                </button>
</div>
</div>
</div>
<!-- Exception Card 2: Collapsed -->
<div class="rounded-lg border border-[#282f39] bg-[#242932] hover:bg-[#2c333d] transition-colors cursor-pointer group">
<div class="p-4">
<div class="flex justify-between items-start mb-2">
<div class="flex gap-3 items-center">
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-orange-500/10 text-orange-500 border border-orange-500/20">
<span class="material-symbols-outlined text-[12px]">warning</span> Material
                                    </span>
<span class="text-xs text-[#505a69] font-mono">Today 09:38 AM</span>
</div>
<input class="rounded border-[#3b4554] bg-[#111418] text-primary focus:ring-0 focus:ring-offset-0 size-4 cursor-pointer" type="checkbox"/>
</div>
<h4 class="text-sm font-semibold text-[#9da8b9] group-hover:text-white transition-colors mb-1">NOI Decrease &gt; 5%</h4>
<p class="text-xs text-[#505a69]">Net Operating Income decreased by 8.4% compared to snapshot.</p>
</div>
</div>
<!-- Exception Card 3: Collapsed -->
<div class="rounded-lg border border-[#282f39] bg-[#242932] hover:bg-[#2c333d] transition-colors cursor-pointer group">
<div class="p-4">
<div class="flex justify-between items-start mb-2">
<div class="flex gap-3 items-center">
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500 border border-blue-500/20">
<span class="material-symbols-outlined text-[12px]">visibility</span> Watch
                                    </span>
<span class="text-xs text-[#505a69] font-mono">Yesterday 4:15 PM</span>
</div>
<input class="rounded border-[#3b4554] bg-[#111418] text-primary focus:ring-0 focus:ring-offset-0 size-4 cursor-pointer" type="checkbox"/>
</div>
<h4 class="text-sm font-semibold text-[#9da8b9] group-hover:text-white transition-colors mb-1">Occupancy Change</h4>
<p class="text-xs text-[#505a69]">Occupancy dropped from 95% to 88%.</p>
</div>
</div>
<!-- Exception Card 4: Collapsed -->
<div class="rounded-lg border border-[#282f39] bg-[#242932] hover:bg-[#2c333d] transition-colors cursor-pointer group">
<div class="p-4">
<div class="flex justify-between items-start mb-2">
<div class="flex gap-3 items-center">
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-500 border border-purple-500/20">
<span class="material-symbols-outlined text-[12px]">schedule</span> Action
                                    </span>
<span class="text-xs text-[#505a69] font-mono">Yesterday 2:00 PM</span>
</div>
<input class="rounded border-[#3b4554] bg-[#111418] text-primary focus:ring-0 focus:ring-offset-0 size-4 cursor-pointer" type="checkbox"/>
</div>
<h4 class="text-sm font-semibold text-[#9da8b9] group-hover:text-white transition-colors mb-1">Rate Reset Pending</h4>
<p class="text-xs text-[#505a69]">Upcoming rate reset in 30 days requires review.</p>
</div>
</div>
</div>
<!-- Section D: Audit Controls -->
<div class="mt-8 mb-4 border-t border-[#282f39] pt-6">
<h3 class="text-xs font-semibold text-[#9da8b9] uppercase tracking-wider mb-4">Routing Controls</h3>
<div class="space-y-3 mb-6">
<label class="flex items-center gap-3 p-3 rounded bg-[#1c2027] border border-[#282f39] cursor-pointer hover:border-[#3b4554] transition-colors">
<input class="bg-transparent border-[#505a69] text-primary focus:ring-0 focus:ring-offset-0" name="decision" type="radio"/>
<span class="text-sm text-white">Log Exception &amp; Monitor</span>
</label>
<label class="flex items-center gap-3 p-3 rounded bg-[#1c2027] border border-[#282f39] cursor-pointer hover:border-[#3b4554] transition-colors">
<input checked="" class="bg-transparent border-[#505a69] text-primary focus:ring-0 focus:ring-offset-0" name="decision" type="radio"/>
<span class="text-sm text-white">Escalate to Committee (Material/Breach)</span>
</label>
<label class="flex items-center gap-3 p-3 rounded bg-[#1c2027] border border-[#282f39] cursor-pointer hover:border-[#3b4554] transition-colors">
<input class="bg-transparent border-[#505a69] text-primary focus:ring-0 focus:ring-offset-0" name="decision" type="radio"/>
<span class="text-sm text-white">Re-open Underwriting</span>
</label>
</div>
<div class="relative">
<label class="block text-xs font-medium text-[#9da8b9] mb-1.5">Audit Comment</label>
<textarea class="w-full bg-[#1c2027] border border-[#3b4554] rounded-lg p-3 text-sm text-white placeholder-[#505a69] focus:ring-1 focus:ring-primary focus:border-primary focus:outline-none min-h-[80px]" placeholder="Explain your decision for the audit log..."></textarea>
</div>
</div>
</div>
<!-- Padding for footer overlap -->
<div class="h-24"></div>
</div>
<!-- Sticky Footer -->
<div class="flex-none p-4 bg-surface-dark border-t border-[#3b4554] flex flex-col gap-3 shadow-[0_-4px_20px_rgba(0,0,0,0.3)] z-20">
<!-- Alert bar if needed -->
<div class="flex items-center gap-2 text-xs text-orange-400 bg-orange-500/10 px-3 py-2 rounded border border-orange-500/20">
<span class="material-symbols-outlined text-[14px]">warning</span>
<span>You are escalating 2 material exceptions to Committee.</span>
</div>
<div class="flex gap-3">
<button class="flex-1 bg-[#282f39] hover:bg-[#323b47] text-[#9da8b9] hover:text-white font-semibold py-2.5 px-4 rounded-lg transition-colors text-sm border border-[#3b4554]">
                    Reject
                </button>
<button class="flex-[2] bg-primary hover:bg-blue-600 text-white font-bold py-2.5 px-4 rounded-lg shadow-lg shadow-primary/20 transition-all text-sm flex items-center justify-center gap-2">
<span class="material-symbols-outlined text-[18px]">check_circle</span>
                    Approve &amp; Escalate
                </button>
</div>
</div>
</aside>`;

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
