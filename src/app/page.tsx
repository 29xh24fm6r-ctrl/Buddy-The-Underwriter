import { Glow } from "@/components/marketing/Glow";
import { TopNav } from "@/components/marketing/TopNav";
import { Hero } from "@/components/marketing/Hero";
import { ProductShot } from "@/components/marketing/ProductShot";
import { Close } from "@/components/marketing/Close";

export default function HomePage() {
  return (
    <main id="top" className="relative">
      <Glow />
      <TopNav />

      <Hero />

      <div className="border-t" />

      <ProductShot
        id="product"
        kicker="Underwriting Decision"
        title="The decision is a single, replayable artifact."
        copy="Not a dashboard. Not a chat. A decision record: inputs → evidence → policy → decision → confidence."
        imgSrc="/marketing/decision.png"
        imgAlt="Buddy underwriting decision one-pager"
        bullets={[
          "Immutable snapshot (audit-ready)",
          "Evidence tied to documents (source-aware)",
          "Policy applied and snapshotted at decision time",
          "Confidence and exceptions are preserved",
        ]}
      />

      <div className="border-t" />

      <ProductShot
        id="replay"
        kicker="Decision Replay"
        title="Time-travel debugging for credit decisions."
        copy={'Ask "why was this approved?" and Buddy shows exactly what was used then — plus what changed since.'}
        imgSrc="/marketing/replay.png"
        imgAlt="Buddy decision replay diff screenshot"
        bullets={[
          "Exact snapshot rendering (no drift)",
          "Diff vs current inputs/policy (what changed?)",
          "Trustable narrative for internal + regulators",
        ]}
        reverse
      />

      <div className="border-t" />

      <ProductShot
        id="governance"
        kicker="Overrides"
        title="Human judgment is first-class — and recorded."
        copy="Overrides aren't hidden edits. They're explicit, visible, logged, and reviewable."
        imgSrc="/marketing/overrides.png"
        imgAlt="Buddy overrides audit-ready screenshot"
        bullets={[
          "Override reason + justification required",
          "Material overrides can require review",
          "Perfect for credit committee + audit trail",
        ]}
      />

      <Close />
    </main>
  );
}
