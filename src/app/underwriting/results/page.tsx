import StitchFrame from "@/components/stitch/StitchFrame";

const TITLE = "Underwriting Results";
const FONT_LINKS = [
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap",
];
const TAILWIND_CDN =
  "https://cdn.tailwindcss.com?plugins=forms,container-queries";

/**
 * NOTE:
 * Your Stitch "underwriting_results_display" HTML is long.
 * Keep using this same pattern:
 * - paste the Stitch tailwind.config script content into TAILWIND_CONFIG_JS
 * - paste Stitch body inner HTML into BODY_HTML
 *
 * I'm keeping a clean placeholder here so you can paste in the full exported body
 * without fighting the assistant response limits.
 */
const TAILWIND_CONFIG_JS = `
tailwind.config = {
  darkMode: "class",
  theme: { extend: {} },
}
`.trim();

const BODY_HTML = `
<main class="min-h-screen flex items-center justify-center p-10">
  <div class="max-w-3xl w-full bg-white rounded-xl border border-slate-200 p-8">
    <h1 class="text-2xl font-bold tracking-tight text-slate-900">Underwriting Results</h1>
    <p class="mt-2 text-slate-600">
      Paste the full Stitch <code>underwriting_results_display/code.html</code> body here to fully render the results UI.
    </p>
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
      bodyHtml={BODY_HTML}
    />
  );
}
