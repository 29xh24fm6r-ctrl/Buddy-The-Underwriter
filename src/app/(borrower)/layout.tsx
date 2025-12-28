import type { ReactNode } from "react";

export default function BorrowerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      {/* Minimal shell: soft vignette, centered content */}
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8">
        {children}
      </div>
    </div>
  );
}
