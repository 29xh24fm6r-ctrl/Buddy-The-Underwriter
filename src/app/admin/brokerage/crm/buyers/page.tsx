import { BankBuyersWorkspace } from "@/components/brokerage/BankBuyersWorkspace";

/** Explicit lender workspace route. Keep lender operations out of organization-id routing. */
export default function BrokerageLenderWorkspacePage() {
  return <BankBuyersWorkspace />;
}
