import type { ReactNode } from "react";
import { Poppins, Plus_Jakarta_Sans } from "next/font/google";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
