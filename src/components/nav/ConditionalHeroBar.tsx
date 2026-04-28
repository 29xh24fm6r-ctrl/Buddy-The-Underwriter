"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { HeroBar } from "@/components/nav/HeroBar";
import { ProfileCompletionBanner } from "@/components/nav/ProfileCompletionBanner";
import { isPublicBorrowerRoute } from "@/lib/nav/isPublicBorrowerRoute";

export function ConditionalHeroBar() {
  const pathname = usePathname();
  // Mount-gate: HeroBar fires useProfile() (→ /api/profile) which 404s for
  // unauthenticated borrower-route requests. Rendering HeroBar during static
  // prerender of public pages (e.g. /start) leaks banker nav into the SSG'd
  // HTML and triggers spurious 404s if hydration is delayed. Defer to after
  // mount so the path-aware check is authoritative.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
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
