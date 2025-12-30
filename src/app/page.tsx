import type { Metadata } from "next";
import MarketingPage from "@/components/marketing/MarketingPage";

export const metadata: Metadata = {
  title: "Buddy — Loan Operations OS",
  description:
    "Meet Buddy: the first true Operating System for commercial lending. Orchestrate documents, borrowers, compliance, underwriting, and decisions—examiner-safe by default.",
  openGraph: {
    title: "Buddy — Loan Operations OS",
    description:
      "A new category of commercial lending: the Loan Operations OS. Built examiner-first. Forged in SBA. Generalized for CRE + C&I.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function Page() {
  return <MarketingPage />;
}
