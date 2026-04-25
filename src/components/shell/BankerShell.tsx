import type { ReactNode } from "react";

/**
 * BankerShell — applies the dark cockpit theme to banker / admin / examiner /
 * cockpit surfaces. Wraps children with `dark bg-bg-dark text-white min-h-screen`
 * so Tailwind `dark:` variants render and the legacy banker bg color is set.
 *
 * Used by route-group layouts that previously relied on the root layout's
 * hardcoded `bg-bg-dark text-white` body styling. Root is now theme-neutral
 * (per Sprint A) so each banker route group must explicitly opt in.
 *
 * Borrower / marketing / public surfaces must NOT use this. They get a light
 * theme via their own route-group layouts (e.g. `(borrower)/layout.tsx`).
 */
export function BankerShell({ children }: { children: ReactNode }) {
  return (
    <div className="dark bg-bg-dark text-white min-h-screen">{children}</div>
  );
}
