"use client";

import { usePathname } from "next/navigation";
import { HeroBar } from "@/components/nav/HeroBar";

export function ConditionalHeroBar() {
  const pathname = usePathname();

  // Hide hero bar only on auth + public share style routes
  const hide =
    pathname?.startsWith("/sign-in") ||
    pathname?.startsWith("/sign-up") ||
    pathname?.startsWith("/share") ||
    pathname?.startsWith("/stitch-share");

  if (hide) return null;
  return <HeroBar />;
}
