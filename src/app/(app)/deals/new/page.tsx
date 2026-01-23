import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import NewDealClient from "./NewDealClient";

export default async function DealIntakePage() {
  const bankId = await getCurrentBankId();
  const initialDealName = `Deal - ${new Date().toLocaleDateString()}`;
  return <NewDealClient bankId={bankId} initialDealName={initialDealName} />;
}
