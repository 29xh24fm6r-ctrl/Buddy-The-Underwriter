"use client";

import { usePathname } from "next/navigation";
import { HeroBar } from "@/components/nav/HeroBar";
import { ProfileCompletionBanner } from "@/components/nav/ProfileCompletionBanner";

export function ConditionalHeroBar() {
  const pathname = usePathname() || "";

  // Hide hero bar on:
  //   - auth + public share + stitch routes (existing)
  //   - borrower + marketing surfaces (Sprint A: borrower front door)
  // Banker / admin / cockpit routes still show the hero bar.
  const hide =
    pathname === "/" ||
    pathname.startsWith("/start") ||
    pathname.startsWith("/for-banks") ||
    pathname.startsWith("/pricing") ||
    pathname.startsWith("/upload") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/share") ||
    pathname.startsWith("/stitch-share") ||
    pathname.startsWith("/stitch");

  if (hide) return null;
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
