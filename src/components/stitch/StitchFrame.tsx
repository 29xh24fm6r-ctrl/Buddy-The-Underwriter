"use client";

import { useEffect, useRef, useState } from "react";

type StitchFrameProps = {
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
}: StitchFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    document.title = title;
  }, [title]);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    // Build complete HTML with scripts embedded
    const fullHtml = `
      ${fontLinks.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n")}
      ${styles.map((css) => `<style>${css}</style>`).join("\n")}
      <script src="${tailwindCdnSrc}"></script>
      ${tailwindConfigJs ? `<script>${tailwindConfigJs}</script>` : ""}
      <style>
  :root { font-size: 14px; }
  body {
    font-size: 14px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  /* Raise common microcopy defaults gently */
  .text-xs { font-size: 0.8125rem !important; }      /* ~13px */
</style>
      ${bodyHtml}
    `;

    containerRef.current.innerHTML = fullHtml;
  }, [mounted, fontLinks, tailwindCdnSrc, tailwindConfigJs, styles, bodyHtml]);

  return <div ref={containerRef} data-stitch="true" suppressHydrationWarning />;
}
