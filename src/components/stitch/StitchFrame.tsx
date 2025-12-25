"use client";

import { useEffect, useRef, useState, type MouseEventHandler } from "react";
import { useRouter } from "next/navigation";
import { getStitchNavHit, resolveStitchRoute } from "@/lib/stitch/stitchNav";
import { sampleDeals } from "@/lib/deals/sampleDeals";

function stripScriptTags(input: string) {
  // If tailwindConfigJs accidentally contains <script>...</script>, strip wrapper.
  return input
    .replace(/^\s*<script[^>]*>\s*/i, "")
    .replace(/\s*<\/script>\s*$/i, "");
}

// GLOBAL_NAV_WIRING_PATCH
function normLabel(raw: string) {
  return (raw || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

const NAV_LABEL_TO_ROUTE: Record<string, string> = {
  // Top + left nav (common)
  "buddy the underwriter": "/",
  "home": "/",
  "command": "/command",
  "deals": "/deals",
  "new deal": "/deals/new",
  "intake": "/deals/new",
  "borrower portal": "/borrower-portal",
  "portal": "/borrower-portal",
  "documents": "/documents",
  "document": "/documents",
  "evidence": "/documents",
  "underwrite": "/underwrite",
  "underwriting": "/underwrite",
  "undrwrt": "/underwrite",
  "pricing": "/pricing",
  "credit memo": "/credit-memo",
  "credit": "/credit-memo",
  "servicing": "/servicing",
  "admin": "/admin",
  "settings": "/settings",
  // If you later add these routes, keep the labels ready:
  "portfolio": "/portfolio",
};

function navRouteFromElement(el: HTMLElement | null): string | null {
  if (!el) return null;

  const aria = el.getAttribute("aria-label") || "";
  const title = el.getAttribute("title") || "";
  const data = el.getAttribute("data-nav") || el.getAttribute("data-route") || "";
  const text = (el.textContent || "").trim();

  const candidates = [data, aria, title, text].filter(Boolean);

  for (const c of candidates) {
    const key = normLabel(c);
    if (!key) continue;

    if (NAV_LABEL_TO_ROUTE[key]) return NAV_LABEL_TO_ROUTE[key];

    // Fuzzy contains match for multiword labels
    for (const [label, route] of Object.entries(NAV_LABEL_TO_ROUTE)) {
      if (key === label) return route;
      if (label.length >= 5 && key.includes(label)) return route;
    }
  }

  return null;
}

// UNDERWRITER_CTA_WIRING_PATCH
function getDealIdFromPath(): string | null {
  try {
    const parts = (typeof window !== "undefined" ? window.location.pathname : "").split("/").filter(Boolean);
    const dealsIdx = parts.indexOf("deals");
    if (dealsIdx >= 0 && parts.length > dealsIdx + 1) {
      const id = parts[dealsIdx + 1];
      if (id && id !== "new") return id;
    }
  } catch {}
  return null;
}

function normBtnLabel(raw: string) {
  return (raw || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type StitchFrameProps = {
  onClick?: MouseEventHandler<HTMLDivElement>;
  className?: string;
  title: string;
  fontLinks?: string[];
  tailwindCdnSrc: string;
  tailwindConfigJs?: string;
  styles?: string[];
  bodyHtml: string;
};

export default function StitchFrame({
  title,
  fontLinks = [],
  tailwindCdnSrc,
  tailwindConfigJs,
  styles = [],
  bodyHtml,
  onClick,
  className,
}: StitchFrameProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  function handleAutoNav(e: React.MouseEvent) {

      // DEALS_CLICKTHROUGH_PATCH
      // Deterministic Deals clickthrough: bypass stitchNav hit parsing and route directly from DOM.
      try {
        if (typeof window !== "undefined" && window.location?.pathname === "/deals") {
          const target = e.target as HTMLElement | null;
          if (target) {            // New Deal button by visible label
            const btn = target.closest("button, a, [role='button']") as HTMLElement | null;
            if (btn) {
              const label = (btn.textContent || "").trim().toLowerCase();
              if (label.includes("new deal")) {
                e.preventDefault();
                e.stopPropagation();
                router.push("/deals/new");
                return;
              }
            }

            // Route table body row clicks
            const tr = target.closest("tbody tr");
            if (tr) {
              const tbody = tr.closest("tbody");
              if (tbody) {
                const rows = Array.from(tbody.querySelectorAll(":scope > tr"));
                const idx = rows.indexOf(tr);
                if (idx >= 0 && idx < sampleDeals.length) {
                  const chosen: any = sampleDeals[idx];
                  const id = chosen?.id ?? `sample-${idx + 1}`;
                  e.preventDefault();
                  e.stopPropagation();
                  router.push(`/deals/${id}/underwriter`);
                  return;
                }
              }
            }
          }
        }
      } catch {}



    
      // Global nav wiring (left rail + top nav)
      try {
        const target = e.target as HTMLElement | null;
        const clickable = target?.closest?.("a, button, [role='button']") as HTMLElement | null;

        // If anchor has a real href to our app routes, honor it
        const href = clickable?.getAttribute?.("href") || "";
        if (href && href.startsWith("/") && !href.startsWith("//")) {
          e.preventDefault();
          e.stopPropagation();
          router.push(href);
          return;
        }

        const route = navRouteFromElement(clickable);
        if (route) {
          e.preventDefault();
          e.stopPropagation();
          router.push(route);
          return;
        }
      } catch {}


      // Underwriter Command Bridge CTAs
      try {
        if (typeof window !== "undefined" && window.location?.pathname?.includes("/deals/") && window.location?.pathname?.includes("/underwriter")) {
          const target = e.target as HTMLElement | null;
          const clickable = target?.closest?.("button, a, [role='button']") as HTMLElement | null;
          const label = normBtnLabel((clickable?.textContent || "").toString());

          const dealId = getDealIdFromPath();

          if (dealId) {
            // Primary CTAs
            if (label.includes("send request bundle") || label.includes("generate link") || label.includes("request link")) {
              e.preventDefault();
              e.stopPropagation();
              router.push(`/deals/${dealId}/portal-inbox`);
              return;
            }

            if (label.includes("assign analyst") || label.includes("assign")) {
              e.preventDefault();
              e.stopPropagation();
              router.push(`/deals/${dealId}/interview`);
              return;
            }

            // Secondary: documents/conditions/memos/pricing
            if (label.includes("documents") || label.includes("doc")) {
              e.preventDefault();
              e.stopPropagation();
              router.push(`/deals/${dealId}/borrower-inbox`);
              return;
            }

            if (label.includes("pricing")) {
              e.preventDefault();
              e.stopPropagation();
              router.push(`/deals/${dealId}/pricing-memo`);
              return;
            }

            if (label.includes("memo")) {
              e.preventDefault();
              e.stopPropagation();
              router.push(`/deals/${dealId}/memo-template`);
              return;
            }

            if (label.includes("terms") || label.includes("loan terms")) {
              e.preventDefault();
              e.stopPropagation();
              router.push(`/deals/${dealId}/loan-terms`);
              return;
            }
          }
        }
      } catch {}

const hit = getStitchNavHit(e.target);
    const mapped = resolveStitchRoute(hit);
    if (mapped) {
      e.preventDefault();
      e.stopPropagation();
      router.push(mapped);
}

  }


  useEffect(() => {
    setMounted(true);
    document.title = title;
  }, [title]);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    // Build complete HTML with scripts embedded
    const fullHtml = `
      ${fontLinks.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n")}
      ${styles.map((css) => `<style>${css}
        /* === TABLE AFFORDANCE === */
        .stitch-root tr {
          transition: background 140ms ease, box-shadow 140ms ease;
        }

        .stitch-root tr:hover {
          background: rgba(255,255,255,0.045);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
}

        .stitch-root tr:active {
          background: rgba(255,255,255,0.065);
}

</style>`).join("\n")}
      <style id="stitch-premium-env">

        /* Delegated toggle feedback */
        .stitch-root .is-active{
          background: rgba(19,109,236,0.18) !important;
          box-shadow:
            inset 0 0 0 1px rgba(19,109,236,0.35),
            0 12px 34px rgba(19,109,236,0.10) !important;
          color: rgba(255,255,255,0.96) !important;
        }


        /* === SELECTION TETHER === */
        .stitch-shell { --tether-y: -9999px; --tether-x: 38%; --tether-w: 62%; }

        .stitch-tether{
          position:absolute;
          inset:0;
          pointer-events:none;
          opacity:0;
          transition: opacity 220ms ease;
          z-index: 4; /* behind stitch-root (z=5) but above vignette/grain */
        }

        .stitch-shell.has-selection .stitch-tether{ opacity: 1; }

        /* The beam */
        .stitch-tether::before{
          content:"";
          position:absolute;
          left: var(--tether-x);
          width: var(--tether-w);
          top: calc(var(--tether-y) - 1px);
          height: 2px;
          border-radius: 999px;
          background:
            linear-gradient(90deg,
              rgba(19,109,236,0.0),
              rgba(19,109,236,0.45),
              rgba(168,85,247,0.28),
              rgba(19,109,236,0.0)
            );
          filter: blur(0.15px);
}

        /* Outer glow */
        .stitch-tether::after{
          content:"";
          position:absolute;
          left: var(--tether-x);
          width: var(--tether-w);
          top: calc(var(--tether-y) - 10px);
          height: 20px;
          background:
            radial-gradient(closest-side,
              rgba(19,109,236,0.18),
              rgba(19,109,236,0.0)
            );
          opacity: 0.9;
        }


        /* === LIVE INTELLIGENCE PULSE === */
        /* Pulse tiny status dots (safe: only small circles) */
        .stitch-root :is(span,div)[class*="rounded-full"][class*="h-2"][class*="w-2"],
        .stitch-root :is(span,div)[class*="rounded-full"][class*="h-3"][class*="w-3"]{
          animation: stitchPulse 2.0s ease-in-out infinite;
        }


        /* === SELECTION ENERGY === */
        .stitch-root tr.is-selected{
          background: rgba(19,109,236,0.13) !important;
          box-shadow:
            inset 0 0 0 1px rgba(19,109,236,0.42),
            0 16px 60px rgba(19,109,236,0.22);
}

        .stitch-root tr.is-selected td{
          text-shadow: 0 0 18px rgba(19,109,236,0.22);
}

        /* When a row is selected, give the right rail a subtle glow (scoped, safe) */
        .stitch-root:has(tr.is-selected) .stitch-shell,
        .stitch-shell:has(tr.is-selected){
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.06),
            0 0 0 1px rgba(19,109,236,0.08),
            0 28px 90px rgba(0,0,0,0.65);
}

        /* === LIVING MOTION === */
        @keyframes stitchFloat {
          0%   { transform: translate3d(0,0,0);
}

          50%  { transform: translate3d(0,-1px,0);
}

          100% { transform: translate3d(0,0,0);
}

        }
        @keyframes stitchPulse {
          0%   { opacity: 0.55; }
          50%  { opacity: 0.95; }
          100% { opacity: 0.55; }
        }

        /* Panels gently "breathe" */
        .stitch-root :is(section,div)[class*="rounded"][class*="border"]{
          will-change: transform, box-shadow;
        }
        .stitch-root :is(section,div)[class*="rounded"][class*="border"]:hover{
          transform: translateY(-1px);
}

        /* Respect reduced motion */
        @media (prefers-reduced-motion: reduce) {
          .stitch-aurora { animation: none !important; }
          .stitch-root * { transition: none !important; }
        }


        /* === SAFE PANEL LIFT === */
        /* Large containers only: width/height heuristics prevent icon bleed */
        .stitch-root :is(div,section)
          :where(
            [class*="grid"],
            [class*="flex"]
          )
          > :is(div,section)
          :where(
            [class*="rounded"],
            [class*="border"]
          ){
          background: linear-gradient(
            180deg,
            rgba(255,255,255,0.03),
            rgba(255,255,255,0.01)
          );
          box-shadow:
            0 8px 24px rgba(0,0,0,0.45),
            inset 0 0 0 1px rgba(255,255,255,0.06);
          transition: box-shadow 220ms ease, transform 220ms ease;
        }

        /* Hover lift for large rows / cards only */
        .stitch-root tr:hover,
        .stitch-root :is(div,section)[class*="hover"]{
          box-shadow:
            0 12px 36px rgba(0,0,0,0.55),
            inset 0 0 0 1px rgba(255,255,255,0.09);
}

        /* Heuristic: add an accent line to panels that look like cards */
        .stitch-root [class*="rounded"][class*="border"]{
          position: relative;
        }
        .stitch-root [class*="rounded"][class*="border"]::before{
          content:"";
          position:absolute;
          inset:0;
          border-radius: inherit;
          pointer-events:none;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
}

        .stitch-root [class*="rounded"][class*="border"]::after{
          content:"";
          position:absolute;
          left:0; top:0; bottom:0;
          width:2px;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(19,109,236,0.0), rgba(19,109,236,0.55), rgba(168,85,247,0.35), rgba(19,109,236,0.0));
          opacity: 0.55;
          filter: blur(0.2px);
          pointer-events:none;
        }


        /* Hide Stitch's internal top header so app HeroBar is the only header */
        .stitch-root [class*="sticky"][class*="top-0"],
        .stitch-root [class*="fixed"][class*="top-0"] {
          display: none !important;
        }

      <style id="stitch-polish">

        /* === PREMIUM GRAPHICS OVERLAYS === */

        @keyframes stitchAuroraDrift {
          0%   { transform: translate3d(0px, 0px, 0); opacity: 0.82; }
          50%  { transform: translate3d(18px, 10px, 0); opacity: 0.92; }
          100% { transform: translate3d(0px, 0px, 0); opacity: 0.82; }
        }
          /* === RESPONSIVE RAIL OVERRIDES (global) === */

          /* Left icon rail: 64px mobile, 80px md+ */
          .stitch-root .flex.flex-1.overflow-hidden > nav.w-\[72px\]{ width: 64px !important; }
          @media (min-width: 768px){
          .stitch-root .flex.flex-1.overflow-hidden > nav.w-\[72px\]{ width: 80px !important; }
          }

          /* Left pipeline rail: clamp + hide on small */
          .stitch-root .flex.flex-1.overflow-hidden > aside.w-\[280px\]{ width: clamp(240px, 22vw, 320px) !important; }
          @media (max-width: 767px){
          .stitch-root .flex.flex-1.overflow-hidden > aside.w-\[280px\]{ display: none !important; }
          }

          /* Right intelligence rail: clamp + hide until xl */
          .stitch-root .flex.flex-1.overflow-hidden > aside.w-\[360px\]{ width: clamp(280px, 26vw, 420px) !important; }
          @media (max-width: 1279px){
          .stitch-root .flex.flex-1.overflow-hidden > aside.w-\[360px\]{ display: none !important; }
          }

          /* Ensure flex center can shrink/grow */
          .stitch-root .flex.flex-1.overflow-hidden > .flex-1{ min-width: 0 !important; }


        .stitch-shell{
          position: relative;
          overflow: hidden;
        }

        .stitch-aurora{
          animation: stitchAuroraDrift 28s ease-in-out infinite;
          position: absolute;
          inset: -120px -120px auto -120px;
          height: 320px;
          pointer-events: none;
          background:
            radial-gradient(600px 220px at 35% 30%, rgba(19,109,236,0.35), transparent 65%),
            radial-gradient(520px 240px at 65% 10%, rgba(168,85,247,0.22), transparent 70%),
            radial-gradient(420px 220px at 85% 55%, rgba(34,197,94,0.14), transparent 72%);
          filter: blur(14px) saturate(1.15);
          opacity: 0.85;
          transform: translateZ(0);
}

        .stitch-vignette{
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(1200px 900px at 50% 25%, rgba(255,255,255,0.03), transparent 60%),
            radial-gradient(1200px 900px at 50% 120%, rgba(0,0,0,0.55), transparent 55%);
          opacity: 0.95;
        }

        .stitch-grain{
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.08;
          mix-blend-mode: overlay;
          background-image:
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
          background-size: 180px 180px;
        }

        /* Ensure overlays sit behind UI */
        .stitch-root{
          position: relative;
          z-index: 5;
        }

        /* Ensure Stitch content can't cover app chrome */
        .stitch-root, .stitch-root * {
          box-sizing: border-box;
        }

        /* If the export uses fixed headers, keep them inside this container */
        .stitch-root [style*="position:fixed"],
        .stitch-root [class*="fixed"] {
          position: sticky !important;
          top: 0 !important;
        }

        /* Never allow the stitch root to become an overlay */
        .stitch-root {
          position: relative !important;
          inset: auto !important;
        }

        /* === ENVIRONMENT DEPTH === */
        body {
          background:
            radial-gradient(1400px 900px at 50% -20%, rgba(19,109,236,0.22), transparent 55%),
            radial-gradient(900px 700px at 15% 30%, rgba(168,85,247,0.14), transparent 55%),
            linear-gradient(180deg, #070A0F 0%, #0B0F14 45%, #070A0F 100%);
}

        /* Page environment */
        html, body { height: 100%; }
        body {
          margin: 0;
          color-scheme: dark;
          background:
            radial-gradient(1200px 800px at 55% -10%, rgba(19,109,236,0.18), transparent 55%),
            radial-gradient(900px 650px at 15% 20%, rgba(168,85,247,0.10), transparent 55%),
            linear-gradient(180deg, #070A0F 0%, #0B0F14 40%, #070A0F 100%);
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }

        /* Stitch root baseline */
        .stitch-root {
          min-height: 100vh;
          color: rgba(255,255,255,0.92);
}

        /* Premium borders & shadows (non-destructive) */
        .stitch-root .border,
        .stitch-root [class*="border-"] {
          border-color: rgba(255,255,255,0.10) !important;
        }

        
        /* === SURFACE LIFT === */
        .stitch-root .bg-gray-900,
        .stitch-root .bg-slate-900,
        .stitch-root .bg-neutral-900 {
          background: linear-gradient(
            180deg,
            rgba(255,255,255,0.04),
            rgba(255,255,255,0.02)
          );
          box-shadow:
            0 1px 0 rgba(255,255,255,0.06),
            0 24px 60px rgba(0,0,0,0.65);
}

.stitch-root .shadow,
        .stitch-root [class*="shadow"] {
          box-shadow:
            0 1px 0 rgba(255,255,255,0.06),
            0 18px 45px rgba(0,0,0,0.55) !important;
        }

        /* Table row affordance */
        .stitch-root tr { transition: background 160ms ease, transform 160ms ease; }
        .stitch-root tr:hover { background: rgba(255,255,255,0.035);
}

        /* Button hover affordance */
        .stitch-root button,
        .stitch-root [role="button"] {
          transition: transform 140ms ease, filter 140ms ease, box-shadow 140ms ease;
        }
        .stitch-root button:hover,
        .stitch-root [role="button"]:hover {
          filter: brightness(1.08);
}

        .stitch-root button:active,
        .stitch-root [role="button"]:active {
          transform: translateY(0.5px);
}

        /* Nicer focus */
        .stitch-root :focus-visible {
          outline: none !important;
          box-shadow: 0 0 0 2px rgba(19,109,236,0.85), 0 0 0 6px rgba(19,109,236,0.18) !important;
          border-radius: 10px;
        }
      </style>

      ${`<div class="stitch-shell" data-shell="true">
        <div class="stitch-aurora" aria-hidden="true"></div>
        <div class="stitch-vignette" aria-hidden="true"></div>
        <div class="stitch-grain" aria-hidden="true"></div>
        <div class="stitch-tether" aria-hidden="true"></div><div class="stitch-root" data-stitch="true">` + bodyHtml + `</div></div>`}
      <style id="stitch-typography-overrides">
        /* === STITCH LAYOUT OVERRIDES (de-squeeze exports) === */
        .stitch-root .max-w-xl { max-width: none !important; }
        .stitch-root .max-w-2xl { max-width: none !important; }
        .stitch-root .max-w-3xl { max-width: none !important; }
        .stitch-root .max-w-4xl { max-width: none !important; }
        .stitch-root .max-w-5xl { max-width: none !important; }
        .stitch-root .max-w-6xl { max-width: none !important; }
        .stitch-root .max-w-7xl { max-width: none !important; }

        /* Keep center sections full-width on wide screens */
        .stitch-root .flex-1.max-w-xl { max-width: none !important; }

        /* Prevent unexpected horizontal clipping */
        .stitch-root { overflow-x: hidden; }

        /* Tier-1 baseline for all Stitch exports */
        .stitch-root {
          font-size: 15px;
          line-height: 1.45;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }

        /* Bump common microcopy utilities */
        .stitch-root .text-xs { font-size: 0.875rem !important; } /* ~14px at root 16, ~13px at root 15 */
        .stitch-root .text-\[10px\] { font-size: 12px !important; }
        .stitch-root .text-\[11px\] { font-size: 13px !important; }
        .stitch-root .text-\[12px\] { font-size: 14px !important; }

        /* Reduce “cramped” feel on dense tables */
        .stitch-root td, .stitch-root th { line-height: 1.35; }
      </style>

    `;

    containerRef.current.innerHTML = fullHtml;

    // Ensure scripts execute (innerHTML does not execute <script> tags)
    const existingTw = containerRef.current.querySelector('script[data-stitch-tailwind="true"]');
    if (!existingTw) {
      const tw = document.createElement("script");
      tw.src = tailwindCdnSrc;
      tw.async = false;
      tw.defer = false;
      tw.setAttribute("data-stitch-tailwind", "true");

      tw.onload = () => {
          if (!tailwindConfigJs) return;

          const cfg = document.createElement("script");
          cfg.type = "text/javascript";

          const cleaned = stripScriptTags(tailwindConfigJs);
          if (cleaned.includes("<")) {
            console.warn(
              "[StitchFrame] Skipping tailwindConfigJs injection because it still contains HTML."
            );
            return;
          }

          cfg.textContent = cleaned;
          cfg.setAttribute("data-stitch-tailwind-config", "true");
          containerRef.current?.appendChild(cfg);
        };

      containerRef.current.appendChild(tw);
}

    // Enable premium row selection highlight inside Stitch HTML
    const root = containerRef.current.querySelector(".stitch-root");
    if (root) {
      root.addEventListener("click", (e) => {
        const tr = (e.target as any)?.closest?.("tr");
        if (!tr) return;
        root.querySelectorAll("tr.is-selected").forEach((n) => n.classList.remove("is-selected"));
        tr.classList.add("is-selected");

        /* tether positioning */
        const shell = containerRef.current?.querySelector(".stitch-shell") as HTMLElement | null;
        if (shell) {
          shell.classList.add("has-selection");
          const shellRect = shell.getBoundingClientRect();
          const trRect = tr.getBoundingClientRect();

          // Y center of selected row, relative to shell
          const y = (trRect.top - shellRect.top) + (trRect.height / 2);

          // Beam starts roughly at the right edge of the main table area and goes into the right rail.
          // These percentages are intentionally heuristic and look great on this layout.
          shell.style.setProperty("--tether-y", `${y}px`);
          shell.style.setProperty("--tether-x", "38%");
          shell.style.setProperty("--tether-w", "62%");
}

      }, true);
}

  }, [mounted, fontLinks, tailwindCdnSrc, tailwindConfigJs, styles, bodyHtml]);
    return (
    <div
      data-stitch-root
ref={containerRef}
        data-stitch="true"
        suppressHydrationWarning
        onClick={onClick}
        onClickCapture={handleAutoNav}
        className={className}
    >
      {/* STITCH_NORMALIZE_START */}
      <style>{`
        [data-stitch-root]{width:100%;min-height:100vh;max-width:none!important;transform:none!important;zoom:1!important;}
        [data-stitch-root] *{transform:none!important;}
        [data-stitch-root] .stitch-body{width:100%;max-width:none!important;}
        [data-stitch-root] .stitch-shell{width:100%;min-height:100vh;}
        [data-stitch-root] .stitch-root{width:100%;}
      `}</style>
      {/* STITCH_NORMALIZE_END */}

      <div className="stitch-shell">
        <div
          className="stitch-root stitch-body"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>
    </div>
  );
}
