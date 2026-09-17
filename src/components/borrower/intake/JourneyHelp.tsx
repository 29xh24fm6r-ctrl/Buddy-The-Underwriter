"use client";
import { useEffect, useState } from "react";
import { BorrowerHelpContactCard } from "@/components/borrower/BorrowerHelpContactCard";
export function JourneyHelp({ dealId }: { dealId: string }) {
  const [contact, setContact] = useState<{
    name: string | null;
    email: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/portal/${encodeURIComponent(dealId)}/context`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setContact(data.bankerContact ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dealId]);
  const email =
    contact?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)
      ? contact.email
      : null;
  return (
    <BorrowerHelpContactCard
      title={
        contact?.name
          ? `Talk with ${contact.name}`
          : "Want a person’s guidance?"
      }
      body={
        email
          ? "Ask your assigned contact about program fit, a document, or your next step."
          : "An SBA resource partner can help you prepare and explore your options. Your application stays here."
      }
      actionLabel={email ? "Email your contact" : "Find local SBA assistance"}
      actionHref={
        email
          ? `mailto:${encodeURIComponent(email)}`
          : "https://legacy.sba.gov/local-assistance/find"
      }
    />
  );
}
