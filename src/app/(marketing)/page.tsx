import { MarketingNav } from "@/components/marketing/MarketingNav";
import { Hero } from "@/components/marketing/sections/Hero";
import { DemoStrip } from "@/components/marketing/sections/DemoStrip";
import { OldWorld } from "@/components/marketing/sections/OldWorld";
import { NewCategory } from "@/components/marketing/sections/NewCategory";
import { Capabilities } from "@/components/marketing/sections/Capabilities";
import { HowItWorks } from "@/components/marketing/sections/HowItWorks";
import { WhoItsFor } from "@/components/marketing/sections/WhoItsFor";
import { Moat } from "@/components/marketing/sections/Moat";
import { FinalCTA } from "@/components/marketing/sections/FinalCTA";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export default function MarketingPage() {
  return (
    <main className="min-h-screen">
      <MarketingNav />
      <Hero />
      <DemoStrip />
      <OldWorld />
      <NewCategory />
      <Capabilities />
      <HowItWorks />
      <WhoItsFor />
      <Moat />
      <FinalCTA />
      <MarketingFooter />
    </main>
  );
}
