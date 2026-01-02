import { HeroConvergence } from "@/components/marketing/HeroConvergence";
import { ConvergenceTimeline } from "@/components/marketing/ConvergenceTimeline";
import { ProofBand } from "@/components/marketing/ProofBand";
import { HowItWorks3Steps } from "@/components/marketing/HowItWorks3Steps";
import { OutcomesGrid } from "@/components/marketing/OutcomesGrid";
import { FAQ } from "@/components/marketing/FAQ";
import { FinalCTA } from "@/components/marketing/FinalCTA";

export default function Home() {
  return (
    <main className="bg-slate-950">
      <HeroConvergence />
      <ConvergenceTimeline />
      <ProofBand />
      <HowItWorks3Steps />
      <OutcomesGrid />
      <FAQ />
      <FinalCTA />
    </main>
  );
}
