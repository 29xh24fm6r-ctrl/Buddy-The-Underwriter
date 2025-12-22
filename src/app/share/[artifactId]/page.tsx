import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Buddy The Underwriter - Public Share Screen";
const FONT_LINKS = [
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap",
];
const TAILWIND_CDN =
  "https://cdn.tailwindcss.com?plugins=forms,container-queries";

const TAILWIND_CONFIG_JS = `
tailwind.config = {
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
      boxShadow: {
        'soft': '0 2px 12px -2px rgba(16, 24, 34, 0.06)',
      }
    },
  },
}
`.trim();

const STYLES = [
  `
body {
  font-feature-settings: "cv11", "ss01";
  -webkit-font-smoothing: antialiased;
}
`.trim(),
];

const BODY_HTML = `
<!-- Top Navigation Bar -->
<header class="sticky top-0 z-20 w-full bg-white border-b border-[#e5e7eb] px-6 h-16 flex items-center justify-between">
  <div class="flex items-center gap-3 text-[#111418]">
    <div class="size-8 flex items-center justify-center bg-primary/10 rounded-lg text-primary">
      <span class="material-symbols-outlined" style="font-size: 20px;">history_edu</span>
    </div>
    <h1 class="text-lg font-bold leading-tight tracking-[-0.015em]">Buddy The Underwriter</h1>
  </div>
  <div class="flex items-center gap-4">
    <button class="hidden sm:flex h-9 items-center justify-center px-4 rounded-lg border border-transparent text-sm font-semibold text-[#64748b] hover:text-[#111418] hover:bg-gray-50 transition-all">
      Continue
    </button>
    <div class="hidden sm:block h-6 w-px bg-[#e5e7eb]"></div>
    <button class="flex h-9 items-center justify-center px-5 rounded-lg bg-primary text-white text-sm font-bold shadow-sm hover:bg-primary/90 active:scale-95 transition-all">
      Export
    </button>
  </div>
</header>

<main class="flex-1 flex flex-col items-center py-8 px-4 sm:px-6 lg:px-8">
  <div class="w-full max-w-[960px] bg-white rounded-xl border border-[#e2e8f0] shadow-soft overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
    <div class="flex flex-wrap items-center justify-between gap-2 px-6 py-3 bg-[#f8fafc] border-b border-[#f1f5f9]">
      <div class="flex items-center gap-2 text-[#64748b]">
        <span class="material-symbols-outlined text-[18px]">auto_mode</span>
        <span class="text-[11px] font-bold tracking-widest uppercase">Commercial Underwriting, Automated.</span>
      </div>
      <div class="flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-white border border-[#e2e8f0]">
        <div class="size-2 rounded-full bg-emerald-500 animate-pulse"></div>
        <span class="text-xs font-medium text-[#475569]">Shared screen</span>
      </div>
    </div>

    <div class="p-6 md:p-10 flex flex-col gap-10">
      <div class="flex flex-col gap-2">
        <h2 class="text-[#111418] tracking-tight text-3xl font-bold leading-tight">Underwriting Dashboard</h2>
        <p class="text-sm text-[#64748b] font-medium">Public view: read-only. Artifact ID in URL route param.</p>
      </div>

      <div class="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-6">
        <div class="text-sm text-[#475569] font-semibold mb-2">Placeholder content</div>
        <div class="text-sm text-[#64748b]">
          Wire this screen to your actual shared underwriting artifact payload.
        </div>
      </div>
    </div>
  </div>
</main>
`.trim();

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
