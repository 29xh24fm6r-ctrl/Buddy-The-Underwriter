import { redirect } from "next/navigation";

const TITLE = "Buddy The Underwriter - Generate Screen";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "primary-hover": "#0f5bbd",
                        "background-light": "#f6f7f8",
                        "background-dark": "#101822",
                        "surface-light": "#ffffff",
                        "surface-dark": "#1a2430",
                        "text-main": "#111418",
                        "text-secondary": "#617289",
                        "border-light": "#e2e8f0",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "body": ["Inter", "sans-serif"],
                    },
                    borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
                },
            },
        }`;
const STYLES: string[] = [];
const BODY_HTML = `<!-- Header -->
<header class="w-full bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
<div class="flex items-center gap-3 text-text-main dark:text-white">
<div class="size-6 text-primary">
<span class="material-symbols-outlined text-[24px]">shield_person</span>
</div>
<h1 class="text-lg font-bold leading-tight tracking-[-0.015em]">Buddy The Underwriter</h1>
</div>
<!-- No navigation links as requested to keep it distraction-free -->
</header>
<!-- Main Content Area -->
<main class="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 w-full">
<!-- Central Card Container -->
<div class="w-full max-w-2xl bg-surface-light dark:bg-surface-dark rounded-xl shadow-sm border border-border-light dark:border-gray-800 overflow-hidden">
<!-- Card Header / Image Area -->
<div class="relative h-48 w-full bg-cover bg-center" data-alt="Abstract minimal geometric architectural pattern in light grey" style="background-image: linear-gradient(180deg, rgba(19, 109, 236, 0.05) 0%, rgba(255, 255, 255, 0) 100%), url('https://lh3.googleusercontent.com/aida-public/AB6AXuDP7DyHoNwZIBlEkQb7FJZJPmz5MZXrsD4cA1lmdrtG84vDFlHslslgZJpsJ3GGEWPMs2vgCDTTbsn-hNbos5MwZoKi0WTSGKBZ3yLF3sBeFKnk1MRlDG6hn6g9Zze41DQb6_2vyHD7QrcZqJrSJZ_hXYIB6KVrvMalYiDkmcZmW4qeRrJx71u2on2osBSn3KPp3iD9NfjZAREt0rkkIMqOzqcguqJzAqr_pAb9jufkwPq5jZ033lckrNTWNWSs2nNfCxNHL9zNilE');">
<div class="absolute inset-0 bg-white/60 dark:bg-background-dark/80 backdrop-blur-[2px]"></div>
<div class="absolute bottom-0 left-0 w-full p-8 pb-6">
<h2 class="text-text-main dark:text-white tracking-tight text-3xl font-bold leading-tight mb-2">What do you want to build?</h2>
<p class="text-text-secondary dark:text-gray-400 text-lg font-medium leading-normal">Describe the underwriting screen or workflow you need.</p>
</div>
</div>
<!-- Input Form Area -->
<div class="p-8 pt-4 flex flex-col gap-6">
<div class="flex flex-col gap-2">
<label class="sr-only" for="prompt-input">Prompt Description</label>
<div class="relative">
<textarea autofocus="" class="form-textarea w-full min-h-[160px] resize-none rounded-lg border border-border-light dark:border-gray-700 bg-white dark:bg-gray-800 text-text-main dark:text-gray-100 placeholder:text-text-secondary/60 focus:border-primary focus:ring-1 focus:ring-primary p-4 text-base leading-relaxed shadow-sm transition-shadow outline-none" id="prompt-input" placeholder="An underwriter dashboard showing loan status, missing documents, and risk flags…"></textarea>
<!-- Optional icon inside text area for visual cue -->
<div class="absolute bottom-3 right-3 text-primary pointer-events-none opacity-50">
<span class="material-symbols-outlined">auto_awesome</span>
</div>
</div>
</div>
<div class="flex flex-col items-center gap-4">
<button class="group w-full sm:w-auto min-w-[200px] flex items-center justify-center gap-2 rounded-lg bg-primary hover:bg-primary-hover text-white h-12 px-8 text-base font-semibold leading-normal tracking-[0.015em] transition-all shadow-md hover:shadow-lg active:transform active:scale-[0.98]">
<span>Generate screen</span>
<span class="material-symbols-outlined text-[20px] transition-transform group-hover:translate-x-1">arrow_forward</span>
</button>
<p class="text-text-secondary dark:text-gray-500 text-sm font-normal text-center">
                        You’ll get a real, usable screen — not a mockup.
                    </p>
</div>
</div>
</div>
</main>
<!-- Footer -->
<footer class="w-full py-6 flex justify-center items-center">
<p class="text-xs text-text-secondary/60 dark:text-gray-600 font-medium tracking-wide uppercase">
            Generated with Buddy The Underwriter
        </p>
</footer>`;

export default function Page() {
  redirect("/generate");
  return null;
}
