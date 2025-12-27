import { NavBar } from "@/components/NavBar";
import { PricingTable } from "@/components/marketing/PricingTable";
import { Footer } from "@/components/marketing/Footer";

export default function PricingPage() {
  return (
    <main className="min-h-screen flex flex-col bg-white">
      <NavBar />
      <div className="flex-1">
        <PricingTable />
      </div>
      <Footer />
    </main>
  );
}
