import type { ReactNode } from "react";

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
 */
export default function BorrowerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="borrower-root min-h-dvh bg-white text-slate-900">
      {children}
    </div>
  );
}
