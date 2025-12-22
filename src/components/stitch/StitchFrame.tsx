"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    document.title = title;
  }, [title]);

  // Build complete HTML with scripts embedded
  const fullHtml = `
    ${fontLinks.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n")}
    ${styles.map((css) => `<style>${css}</style>`).join("\n")}
    <script src="${tailwindCdnSrc}"></script>
    ${tailwindConfigJs ? `<script>${tailwindConfigJs}</script>` : ""}
    ${bodyHtml}
  `;

  return <div dangerouslySetInnerHTML={{ __html: fullHtml }} />;
}
