import { redirect } from "next/navigation";

const TITLE = "Buddy Login";
const FONT_LINKS: string[] = [];
const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,container-queries";
const TAILWIND_CONFIG_JS = `tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#136dec",
                        "primary-dark": "#105bb5",
                        "background-light": "#f6f7f8",
                        "background-dark": "#101822",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"]
                    },
                    borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
                },
            },
        }`;
const STYLES: string[] = [];
const BODY_HTML = `<!-- Top Navigation (Minimal) -->
<header class="w-full px-6 py-4 sm:px-10 flex items-center justify-between absolute top-0 left-0 z-10">
<div class="flex items-center gap-2">
<div class="size-6 text-[#111418] dark:text-white">
<svg fill="none" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_buddy)">
<path clip-rule="evenodd" d="M24 0.757355L47.2426 24L24 47.2426L0.757355 24L24 0.757355ZM21 35.7574V12.2426L9.24264 24L21 35.7574Z" fill="currentColor" fill-rule="evenodd"></path>
</g>
<defs>
<clippath id="clip0_buddy"><rect height="48" width="48"></rect></clippath>
</defs>
</svg>
</div>
<h1 class="text-xl font-bold tracking-tight text-[#111418] dark:text-white">Buddy</h1>
</div>
<!-- Optional: Right side nav items could go here -->
</header>
<!-- Main Content Area -->
<main class="flex-1 flex items-center justify-center p-4">
<div class="w-full max-w-[440px] flex flex-col items-center">
<!-- Login Card -->
<div class="w-full bg-white dark:bg-[#1a2634] rounded-xl border border-[#e5e7eb] dark:border-[#2a3644] shadow-sm p-8 sm:p-10">
<!-- Header -->
<div class="text-center mb-8">
<h2 class="text-2xl font-bold tracking-tight text-[#111418] dark:text-white mb-2">Sign in to Buddy</h2>
<p class="text-[#637588] dark:text-[#94a3b8] text-sm font-normal">Generate production-ready screens in seconds.</p>
</div>
<!-- Google Auth Button -->
<button class="w-full flex items-center justify-center gap-3 bg-white dark:bg-[#2a3644] border border-[#dbe0e6] dark:border-[#3e4c5e] hover:bg-[#f8f9fa] dark:hover:bg-[#324050] text-[#111418] dark:text-white h-11 px-4 rounded-lg transition-colors duration-200">
<svg aria-hidden="true" class="size-5" viewbox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>
<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>
<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"></path>
<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>
</svg>
<span class="text-sm font-semibold">Continue with Google</span>
</button>
<!-- Divider -->
<div class="relative flex items-center py-6">
<div class="flex-grow border-t border-[#e5e7eb] dark:border-[#2a3644]"></div>
<span class="flex-shrink-0 mx-4 text-[#637588] dark:text-[#94a3b8] text-xs font-medium uppercase">or</span>
<div class="flex-grow border-t border-[#e5e7eb] dark:border-[#2a3644]"></div>
</div>
<!-- Email Form -->
<form class="flex flex-col gap-4">
<label class="flex flex-col gap-1.5">
<span class="text-sm font-semibold text-[#111418] dark:text-white">Email address</span>
<input class="w-full rounded-lg border border-[#dbe0e6] dark:border-[#3e4c5e] bg-white dark:bg-[#121c26] px-4 h-11 text-base text-[#111418] dark:text-white placeholder-[#637588] dark:placeholder-[#64748b] focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all" name="email" placeholder="name@work-email.com" type="email"/>
</label>
<button class="w-full bg-primary hover:bg-primary-dark text-white font-semibold h-11 px-4 rounded-lg transition-colors duration-200 mt-2 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        Continue
                    </button>
</form>
<!-- Terms -->
<p class="mt-6 text-center text-xs text-[#637588] dark:text-[#94a3b8] leading-relaxed">
                    By continuing, you agree to Buddy’s <a class="underline hover:text-primary transition-colors" href="#">Terms of Service</a> and <a class="underline hover:text-primary transition-colors" href="#">Privacy Policy</a>.
                </p>
</div>
</div>
</main>
<!-- Simple Footer -->
<footer class="w-full py-6 text-center">
<p class="text-xs text-[#94a3b8] dark:text-[#64748b] font-medium">Generated with Buddy</p>
</footer>`;

export default function Page() {
  redirect("/sign-in");
  return null;
}
