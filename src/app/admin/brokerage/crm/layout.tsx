import "server-only";
import { Suspense } from "react";
import type { ReactNode } from "react";
import { CrmExperienceProvider } from "@/components/brokerage/CrmExperienceProvider";
import { isCrmExperienceEnabled } from "@/lib/crm/experience";
import "./experience.css";

/** Staff authorization remains in the parent brokerage layout. */
export default function CrmLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p role="status">Opening CRM…</p>}>
      <CrmExperienceProvider enabled={isCrmExperienceEnabled(process.env.BUDDY_CRM_EXPERIENCE_V2_ENABLED)}>
        {children}
      </CrmExperienceProvider>
    </Suspense>
  );
}
