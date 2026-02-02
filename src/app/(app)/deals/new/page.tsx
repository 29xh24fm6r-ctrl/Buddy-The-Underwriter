import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import NewDealClient from "./NewDealClient";

export default async function DealIntakePage() {
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) {
    redirect(bankPick.reason === "not_authenticated" ? "/sign-in" : "/select-bank");
  }
  const bankId = bankPick.bankId;
  const initialDealName = `Deal - ${new Date().toLocaleDateString()}`;
  return <NewDealClient bankId={bankId} initialDealName={initialDealName} />;
}
