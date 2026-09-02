"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { crmSection } from "@/lib/crm/experience";

const CrmExperienceContext = createContext(false);

export function CrmExperienceProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <CrmExperienceContext.Provider value={enabled}>{children}</CrmExperienceContext.Provider>;
}

export function useCrmExperience() {
  const enabled = useContext(CrmExperienceContext);
  const pathname = usePathname();
  const params = useSearchParams();
  return { enabled, section: crmSection(pathname, params.get("view")) };
}
