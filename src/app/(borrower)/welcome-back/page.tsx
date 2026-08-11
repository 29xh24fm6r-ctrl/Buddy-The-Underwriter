import { WelcomeBackClient } from "./WelcomeBackClient";
import { BorrowerTrustFooter } from "@/components/borrower/BorrowerTrustFooter";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign back in - Buddy",
  description:
    "Returning to Buddy? Verify your email to find and continue your existing SBA loan applications.",
};

export default function WelcomeBackPage() {
  return (
    <main className="min-h-screen bg-[#f6f8fb]">
      <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
        <WelcomeBackClient />
        <div className="mt-6">
          <BorrowerTrustFooter />
        </div>
      </div>
    </main>
  );
}
