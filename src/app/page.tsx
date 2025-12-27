import { NavBar } from "@/components/NavBar";
import { Hero } from "@/components/marketing/Hero";
import { Features } from "@/components/marketing/Features";
import { PricingTable } from "@/components/marketing/PricingTable";
import { Testimonials } from "@/components/marketing/Testimonials";
import { Footer } from "@/components/marketing/Footer";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      <NavBar />
      <Hero />
      <Features />
      <PricingTable />
      <Testimonials />
      <Footer />
    </main>
  );
}
