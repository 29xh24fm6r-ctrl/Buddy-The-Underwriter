import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { SafeBoundary } from "@/components/SafeBoundary";
import NewDealClient from "./NewDealClient";

export default async function DealIntakePage() {
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) {
    redirect("/select-bank"); // middleware owns auth; page owns bank-state only
  }
  const bankId = bankPick.bankId;
  const initialDealName = `Deal - ${new Date().toLocaleDateString()}`;
  // Wrap NewDealClient in a top-level SafeBoundary so any client-side throw
  // (hydration mismatch, ref-after-unmount, third-party library exception)
  // surfaces a recoverable error panel with the actual stack instead of a
  // blank page after upload. The boundary preserves the user's progress —
  // their docs are already persisted server-side; they just need to navigate
  // to the cockpit to continue.
  return (
    <SafeBoundary>
      <NewDealClient bankId={bankId} initialDealName={initialDealName} />
    </SafeBoundary>
  );
}
