import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import NewDealClient from "./NewDealClient";

export default async function DealIntakePage() {
  const bankId = await getCurrentBankId();
  return <NewDealClient bankId={bankId} />;
}
