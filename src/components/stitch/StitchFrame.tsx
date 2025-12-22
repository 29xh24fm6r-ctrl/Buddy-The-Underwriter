"use client";

import Script from "next/script";

type StitchFrameProps = {
  title: string;
  fontLinks?: string[];
  tailwindCdnSrc: string;
  tailwindConfigJs?: string; // contents of the <script id="tailwind-config">...</script>
  styles?: string[]; // contents of <style> blocks
  bodyHtml: string; // inner HTML of <body>...</body>
};

/**
 * StitchFrame
 * - Preserves Stitch exports exactly (fonts, tailwind CDN, tailwind.config, inline CSS, body markup)
 * - Renders body markup via dangerouslySetInnerHTML
 *
 * Later (optional): migrate off CDN tailwind into your real tailwind.config + className JSX.
 */
export default function StitchFrame({
  title,
  fontLinks = [],
  tailwindCdnSrc,
  tailwindConfigJs,
  styles = [],
  bodyHtml,
}: StitchFrameProps) {
  return (
    <>
      {/* Title */}
      <title>{title}</title>

      {/* Fonts / icon fonts */}
      {fontLinks.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}

      {/* Tailwind CDN (as Stitch expects) */}
      <Script src={tailwindCdnSrc} strategy="beforeInteractive" />

      {/* Tailwind config (as Stitch expects) */}
      {tailwindConfigJs?.trim() ? (
        <Script id="stitch-tailwind-config" strategy="beforeInteractive">
          {tailwindConfigJs}
        </Script>
      ) : null}

      {/* Any inline CSS from Stitch head */}
      {styles.map((css, i) => (
        <style key={i} dangerouslySetInnerHTML={{ __html: css }} />
      ))}

      {/* Body markup */}
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </>
  );
}
