import StitchFrame from "@/components/stitch/StitchFrame";

const FONT_LINKS: string[] = [
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
  "https://fonts.googleapis.com/icon?family=Material+Icons+Round",
];

const TAILWIND_CDN = "https://cdn.tailwindcss.com?plugins=forms,typography";

const TAILWIND_CONFIG_JS = `
tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#3b82f6",
      },
      fontFamily: {
        display: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
};
`;

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function ShellPage({
  title,
  subtitle,
  active,
}: {
  title: string;
  subtitle?: string;
  active?: "home" | "deals" | "evidence" | "portal" | "ops" | "generate";
}) {
  const t = escapeHtml(title);
  const sub = escapeHtml(subtitle ?? "");

  const navItem = (label: string, href: string, key: string) => {
    const isActive = active === (key as any);
    return `
      <a href="${href}"
         class="px-3 py-2 rounded-lg text-sm font-semibold ${
           isActive
             ? "bg-white/10 text-white"
             : "text-slate-200 hover:bg-white/5 hover:text-white"
         }">
        ${label}
      </a>
    `;
  };

  const bodyHtml = `
  <div class="min-h-screen bg-[radial-gradient(900px_500px_at_20%_-10%,rgba(59,130,246,0.18),transparent_55%),radial-gradient(900px_500px_at_80%_0%,rgba(16,185,129,0.12),transparent_55%),linear-gradient(to_bottom,rgba(2,6,23,1),rgba(2,6,23,1))] text-slate-100">
    <div class="mx-auto max-w-6xl px-6 py-6">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center font-bold">B</div>
          <div>
            <div class="text-sm font-semibold">Buddy Underwriter</div>
            <div class="text-xs text-slate-300">Command Bridge</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${navItem("Home", "/home", "home")}
          ${navItem("Deals", "/deals", "deals")}
          ${navItem("Evidence", "/evidence", "evidence")}
          ${navItem("Portal", "/portal", "portal")}
          ${navItem("Ops", "/ops", "ops")}
          ${navItem("Generate", "/generate", "generate")}
        </div>
      </div>

      <div class="mt-10">
        <h1 class="text-4xl font-semibold tracking-tight text-white">${t}</h1>
        ${sub ? `<p class="mt-3 text-lg text-slate-200">${sub}</p>` : ""}
      </div>

      <div class="mt-8 grid gap-4 md:grid-cols-2">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-bold tracking-wide text-slate-100">Status</div>
          <div class="mt-2 text-slate-300">Screen scaffolded and ready for wiring.</div>
          <div class="mt-4 text-xs text-slate-400">Next: connect to APIs + real data.</div>
        </div>

        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-bold tracking-wide text-slate-100">Quick Links</div>
          <div class="mt-3 flex flex-wrap gap-2">
            <a class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15" href="/deals">Open Deals</a>
            <a class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15" href="/generate">Generate</a>
            <a class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15" href="/underwriting/results">Results</a>
            <a class="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15" href="/share/test-id">Share</a>
          </div>
        </div>
      </div>
    </div>
  </div>
  `;

  return (
    <StitchFrame
      title={`Buddy - ${title}`}
      fontLinks={FONT_LINKS}
      tailwindCdnSrc={TAILWIND_CDN}
      tailwindConfigJs={TAILWIND_CONFIG_JS}
      styles={[]}
      bodyHtml={bodyHtml}
    />
  );
}
