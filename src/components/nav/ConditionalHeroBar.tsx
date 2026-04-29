"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { HeroBar } from "@/components/nav/HeroBar";
import { ProfileCompletionBanner } from "@/components/nav/ProfileCompletionBanner";
import { isPublicBorrowerRoute } from "@/lib/nav/isPublicBorrowerRoute";

export function ConditionalHeroBar() {
  const pathname = usePathname();
  // HeroBar fires useProfile() (→ /api/profile) which 401s for unauthenticated
  // borrower-route requests. Three defenses:
  //   1. Mount-gate: skip until after first client paint.
  //   2. Pathname-gate: usePathname() can return null during initial render
  //      under static prerender; treat null as "unknown" → don't render.
  //      Without this, isPublicBorrowerRoute(null) returns false and HeroBar
  //      mounts for one tick before pathname resolves, firing useProfile.
  //   3. Public-route gate: explicit allowlist match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  if (!pathname) return null;
  if (isPublicBorrowerRoute(pathname)) return null;

  return (
    <>
      <div className="sticky top-0 z-[2000] bg-black/40 backdrop-blur-xl border-b border-white/10">
        <HeroBar />
        <ProfileCompletionBanner />
      </div>
      <div className="h-16" />
    </>
  );
}
