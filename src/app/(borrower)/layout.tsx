import type { ReactNode } from "react";
import localFont from "next/font/local";

const poppins = localFont({
  src: [
    { path: "../../../public/fonts/Poppins-500.woff2", weight: "500", style: "normal" },
    { path: "../../../public/fonts/Poppins-600.woff2", weight: "600", style: "normal" },
    { path: "../../../public/fonts/Poppins-700.woff2", weight: "700", style: "normal" },
    { path: "../../../public/fonts/Poppins-800.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-poppins",
  display: "swap",
});

const jakarta = localFont({
  src: "../../../public/fonts/PlusJakartaSans-Variable.woff2",
  variable: "--font-jakarta",
  display: "swap",
});

/**
 * Borrower route-group layout.
 *
 * Sprint A — Borrower Front Door:
 *   - Light theme (white bg, slate-900 text). Dark cockpit is for banker
 *     surfaces only.
 *   - No max-width / page-padding wrapper here — individual borrower pages
 *     own their own width and padding decisions (the old wrapper was
 *     forcing a 1400px container that fought against /portal/[token]'s
 *     own layout).
 *   - The `borrower-root` class is the hook for `color-scheme: light` in
 *     globals.css, which prevents UA-rendered controls (scrollbars, native
 *     form inputs) from rendering dark.
 *   - Poppins/Jakarta match the marketing site's brand fonts (see
 *     BrokerageLandingPage.tsx) so the borrower app reads as the same
 *     product, not a different tool bolted on.
 */
export default function BorrowerLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`borrower-root min-h-dvh bg-white font-jakarta text-slate-900 ${poppins.variable} ${jakarta.variable}`}
    >
      {children}
    </div>
  );
}
