"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { HeroBar } from "@/components/nav/HeroBar";

export function ConditionalHeroBar() {
  const pathname = usePathname() || "/";
  const [isStitch, setIsStitch] = useState(false);

  useEffect(() => {
    // StitchFrame sets data-stitch="true" on its root container
    const el = document.querySelector('[data-stitch="true"]');
    setIsStitch(Boolean(el));
  }, [pathname]);

  // Always hide on print/doc surfaces
  if (pathname.includes("/memos/")) return null;

  // Hide on all StitchFrame pages (they include their own headers/nav)
  if (isStitch) return null;

  return <HeroBar />;
}
