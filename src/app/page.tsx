import { BrokerageHero } from "@/components/marketing/BrokerageHero";
import { BrokerageHowItWorks } from "@/components/marketing/BrokerageHowItWorks";
import { BrokerageNeutralityPromise } from "@/components/marketing/BrokerageNeutralityPromise";
import { BrokerageFAQ } from "@/components/marketing/BrokerageFAQ";
import { BrokerageFinalCTA } from "@/components/marketing/BrokerageFinalCTA";

export default function Home() {
  return (
    <main className="bg-white">
      <BrokerageHero />
      <BrokerageHowItWorks />
      <BrokerageNeutralityPromise />
      <BrokerageFAQ />
      <BrokerageFinalCTA />
    </main>
  );
}
